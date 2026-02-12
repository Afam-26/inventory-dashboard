// inventory-backend/routes/billing.js
import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";
import { requireBillingAdmin } from "../middleware/billing.js";
import { PLANS, getTenantEntitlements } from "../config/plans.js";
import {
  normalizePlanKey,
  normalizeInterval,
  priceIdForPlan,
  planKeyFromSubscription,
} from "../config/stripePlans.js";
import { logAudit, SEVERITY } from "../utils/audit.js";
import { getStripe, stripeIsEnabled } from "../services/stripe/stripe.js";

const router = express.Router();
router.use(requireAuth, requireTenant);

async function getTenantRow(tenantId) {
  const [[t]] = await db.query(
    `SELECT id, name, plan_key, status,
            stripe_customer_id, stripe_subscription_id, stripe_price_id,
            plan_status, current_period_end, trial_used_at
     FROM tenants
     WHERE id=? LIMIT 1`,
    [tenantId]
  );
  return t || null;
}

async function updateTenantStripeCustomerId(tenantId, customerId) {
  await db.query(
    "UPDATE tenants SET stripe_customer_id = ? WHERE id = ? LIMIT 1",
    [customerId, tenantId]
  );
}

async function getTenantUsage(tenantId) {
  const [[cat]] = await db.query(
    `SELECT COUNT(*) AS c FROM categories WHERE tenant_id=? AND deleted_at IS NULL`,
    [tenantId]
  );
  const [[prod]] = await db.query(
    `SELECT COUNT(*) AS c FROM products WHERE tenant_id=? AND deleted_at IS NULL`,
    [tenantId]
  );
  const [[users]] = await db.query(
    `SELECT COUNT(*) AS c FROM tenant_members WHERE tenant_id=? AND status='active'`,
    [tenantId]
  );

  return {
    categories: Number(cat?.c || 0),
    products: Number(prod?.c || 0),
    users: Number(users?.c || 0),
  };
}

function makeUsageLine({ used, limit }) {
  const lim = limit === Infinity || limit == null ? null : Number(limit);
  return {
    used: Number(used || 0),
    limit: lim,
    pct: lim ? Math.min(100, Math.round((Number(used || 0) / lim) * 100)) : null,
    ok: lim ? Number(used || 0) <= lim : true,
  };
}

function mapTenantStatusFromStripe(subStatus) {
  if (subStatus === "active" || subStatus === "trialing") return "active";
  if (subStatus === "past_due" || subStatus === "unpaid") return "past_due";
  // treat anything else as canceled/locked
  return "canceled";
}

async function safeAudit(req, entry) {
  try {
    await logAudit(req, entry);
  } catch {}
}

// Fix “No such customer” when switching test/live
async function ensureStripeCustomer({ stripe, tenantId, existingCustomerId }) {
  if (existingCustomerId) {
    try {
      const c = await stripe.customers.retrieve(existingCustomerId);
      if (c && !c.deleted) return existingCustomerId;
    } catch {
      // ignore -> create new
    }
  }

  const customer = await stripe.customers.create({
    metadata: { tenantId: String(tenantId) },
  });

  await db.query("UPDATE tenants SET stripe_customer_id=? WHERE id=?", [customer.id, tenantId]);
  return customer.id;
}

router.get("/plans", async (req, res) => {
  res.json({
    plans: Object.values(PLANS).map((p) => ({
      key: p.key,
      name: p.name,
      priceLabel: p.priceLabel || null,
      limits: {
        categories: p.limits?.categories ?? null,
        products: p.limits?.products ?? null,
        users: p.limits?.users ?? null,
        auditDays: p.limits?.auditDays ?? null,
      },
      features: p.features || {},
    })),
    stripeEnabled: stripeIsEnabled(),
  });
});

router.get("/current", async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const t = await getTenantRow(tenantId);
    if (!t) return res.status(404).json({ message: "Tenant not found" });

    const planKey = normalizePlanKey(t.plan_key);
    const plan = PLANS[planKey] || PLANS.starter;

    const ent = getTenantEntitlements(t);
    const limits = ent?.limits || {};
    const usage = await getTenantUsage(tenantId);

    res.json({
      tenantId,
      planKey,
      planName: plan?.name || planKey,
      priceLabel: plan?.priceLabel || null,
      tenantStatus: t.status || "active",
      stripe: {
        enabled: stripeIsEnabled(),
        customerId: t.stripe_customer_id || null,
        subscriptionId: t.stripe_subscription_id || null,
        status: t.plan_status || null,
        currentPeriodEnd: t.current_period_end || null,
        priceId: t.stripe_price_id || null,
      },
      trial: { usedAt: t.trial_used_at || null },
      entitlements: ent,
      usage: {
        categories: makeUsageLine({ used: usage.categories, limit: limits.categories }),
        products: makeUsageLine({ used: usage.products, limit: limits.products }),
        users: makeUsageLine({ used: usage.users, limit: limits.users }),
      },
    });
  } catch (e) {
    console.error("BILLING CURRENT ERROR:", e);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * POST /api/billing/stripe/checkout
 * Body: { planKey, interval }
 *
 * ✅ 7-day trial ONLY for Starter
 * ✅ Bussine/Pro = NO trial
 */
router.post("/stripe/checkout", requireRole("owner"), requireBillingAdmin, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ message: "Stripe not configured" });

  try {
    const tenantId = req.tenantId;
    const t = await getTenantRow(tenantId);
    if (!t) return res.status(404).json({ message: "Tenant not found" });

    const planKey = normalizePlanKey(req.body?.planKey);
    const interval = normalizeInterval(req.body?.interval);

    const priceId = priceIdForPlan(planKey, interval);
    if (!priceId) {
      return res.status(400).json({ message: `Missing Stripe price id for ${planKey} (${interval})` });
    }

    const front = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";
    const successUrl = `${front}/billing?success=1`;
    const cancelUrl = `${front}/billing?canceled=1`;

    const customerId = await ensureStripeCustomer({
      stripe,
      tenantId,
      existingCustomerId: t.stripe_customer_id,
    });

    // ✅ trial eligibility: ONLY starter AND only once per tenant
    const isStarter = planKey === "starter";
    const isTrialEligible = isStarter && !t.trial_used_at;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: String(tenantId),
      metadata: { tenantId: String(tenantId), planKey, interval },
      payment_method_collection: "always",

      // ✅ only Starter gets trial
      subscription_data: isTrialEligible
        ? { trial_period_days: 7, metadata: { tenantId: String(tenantId) } }
        : { metadata: { tenantId: String(tenantId) } },
    });

    // Mark trial as used when we create a Starter trial checkout
    if (isTrialEligible) {
      await db.query("UPDATE tenants SET trial_used_at=NOW() WHERE id=? AND trial_used_at IS NULL", [tenantId]);
    }

    res.json({ url: session.url });
  } catch (e) {
    console.error("STRIPE CHECKOUT ERROR:", e);
    res.status(500).json({ message: "Stripe error" });
  }
});

/**
 * POST /api/billing/stripe/portal
 */
// routes/billings.js
router.post(
  "/stripe/portal",
  requireRole("owner"),
  requireBillingAdmin,
  async (req, res) => {
    const stripe = getStripe();
    if (!stripe) return res.status(400).json({ message: "Stripe not configured" });

    try {
      const tenantId = req.tenantId;
      const t = await getTenantRow(tenantId);
      if (!t) return res.status(404).json({ message: "Tenant not found" });

      const front =
        process.env.FRONTEND_URL ||
        process.env.APP_URL ||
        "http://localhost:5173";

      let customerId = t.stripe_customer_id || null;

      async function createAndSaveCustomer() {
        const customer = await stripe.customers.create({
          name: t.name,
          metadata: { tenant_id: String(t.id) },
        });

        await updateTenantStripeCustomerId(tenantId, customer.id);
        customerId = customer.id;
      }

      if (!customerId) {
        await createAndSaveCustomer();
      } else {
        try {
          const existing = await stripe.customers.retrieve(customerId);
          if (!existing || existing.deleted) throw new Error("Invalid");
        } catch {
          // customer does not exist in this Stripe account/mode
          await createAndSaveCustomer();
        }
      }

      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${front}/billing`,
      });

      res.json({ url: portal.url });
    } catch (e) {
      console.error("STRIPE PORTAL ERROR:", e);
      res.status(500).json({ message: "Stripe error" });
    }
  }
);

router.get("/stripe/prices", requireRole("owner"), requireBillingAdmin, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ message: "Stripe not configured" });

  try {
    const ids = {
      starter: {
        monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY,
        yearly: process.env.STRIPE_PRICE_STARTER_YEARLY,
      },
      business: {
        monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
        yearly: process.env.STRIPE_PRICE_BUSINESS_YEARLY,
      },
      pro: {
        monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
        yearly: process.env.STRIPE_PRICE_PRO_YEARLY,
      },
    };

    async function readPrice(priceId) {
      if (!priceId) return null;
      const p = await stripe.prices.retrieve(priceId);
      return {
        id: p.id,
        currency: p.currency,
        unit_amount: p.unit_amount, // cents
        recurring: p.recurring?.interval || null, // "month" / "year"
      };
    }

    const out = {};
    for (const planKey of Object.keys(ids)) {
      out[planKey] = {
        monthly: await readPrice(ids[planKey].monthly),
        yearly: await readPrice(ids[planKey].yearly),
      };
    }

    res.json(out);
  } catch (e) {
    console.error("STRIPE PRICES ERROR:", e);
    res.status(500).json({ message: "Stripe error" });
  }
});

/**
 * Webhook handler (unchanged from your working version)
 * - keeps tenants.plan_key updated from subscription price
 */
export async function billingWebhookHandler(req, res) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !secret) return res.status(400).send("Stripe webhook not configured");

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (e) {
    console.error("WEBHOOK SIGNATURE ERROR:", e?.message || e);
    return res.status(400).send("Bad signature");
  }

  // 1) Idempotency: record event id (dedupe)
  try {
    await db.query(
      `INSERT INTO stripe_webhook_events (event_id, type, livemode, status)
       VALUES (?, ?, ?, 'received')
       ON DUPLICATE KEY UPDATE event_id = event_id`,
      [event.id, event.type, event.livemode ? 1 : 0]
    );
  } catch (e) {
    // If DB is shaky, ACK 200 so Stripe doesn't hammer retries
    console.error("WEBHOOK EVENT LOG INSERT ERROR (ack anyway):", e?.message || e);
    return res.json({ received: true });
  }

  // If already processed, ACK immediately
  try {
    const [[row]] = await db.query(
      `SELECT status FROM stripe_webhook_events WHERE event_id=? LIMIT 1`,
      [event.id]
    );
    if (row?.status === "processed") return res.json({ received: true, deduped: true });
  } catch (e) {
    // Even if this fails, continue; processing may still work
    console.error("WEBHOOK EVENT STATUS READ ERROR:", e?.message || e);
  }

  // 2) ACK quickly (fast response to Stripe)
  res.json({ received: true });

  // 3) Process in background (best effort)
  (async () => {
    try {
      async function resolveTenantId({ subId, customerId, metadata }) {
        if (subId) {
          const [[tBySub]] = await db.query(
            "SELECT id FROM tenants WHERE stripe_subscription_id=? LIMIT 1",
            [subId]
          );
          if (tBySub?.id) return tBySub.id;
        }

        if (customerId) {
          const [[tByCust]] = await db.query(
            "SELECT id FROM tenants WHERE stripe_customer_id=? LIMIT 1",
            [customerId]
          );
          if (tByCust?.id) return tByCust.id;
        }

        const metaTenantId = metadata?.tenantId || metadata?.tenant_id;
        if (metaTenantId) return Number(metaTenantId) || null;

        return null;
      }

      if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
        const sub = event.data.object;

        const customerId = sub.customer;
        const planKey = planKeyFromSubscription(sub);
        const priceId = sub.items?.data?.[0]?.price?.id || null;

        const plan_status = sub.status || null;
        const status = mapTenantStatusFromStripe(plan_status);
        const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;

        const tenantId = await resolveTenantId({ subId: sub.id, customerId, metadata: sub.metadata });

        if (tenantId) {
          await db.query(
            `UPDATE tenants
             SET
               plan_key=?,
               status=?,
               stripe_customer_id=?,
               stripe_subscription_id=?,
               stripe_price_id=?,
               plan_status=?,
               current_period_end=?
             WHERE id=?`,
            [planKey, status, customerId, sub.id, priceId, plan_status, periodEnd, tenantId]
          );
        }
      } else if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object;
        const customerId = sub.customer;

        const tenantId = await resolveTenantId({ subId: sub.id, customerId, metadata: sub.metadata });

        if (tenantId) {
          await db.query(
            `UPDATE tenants
             SET status='canceled', plan_status=?, current_period_end=NULL
             WHERE id=?`,
            [sub.status || "canceled", tenantId]
          );
        }
      }

      await db.query(
        `UPDATE stripe_webhook_events
         SET status='processed', processed_at=NOW(), error_message=NULL
         WHERE event_id=?`,
        [event.id]
      );
    } catch (e) {
      console.error("WEBHOOK PROCESS ERROR:", e?.message || e);
      try {
        await db.query(
          `UPDATE stripe_webhook_events
           SET status='failed', processed_at=NOW(), error_message=?
           WHERE event_id=?`,
          [String(e?.message || e).slice(0, 500), event.id]
        );
      } catch {}
    }
  })();
}

export default router;
