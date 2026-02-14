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

/* =========================
   Helpers
========================= */
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
  return "canceled";
}

async function safeAudit(req, entry) {
  try {
    await logAudit(req, entry);
  } catch {}
}

// Fix “No such customer” when switching test/live
async function ensureStripeCustomer({ stripe, tenantId, existingCustomerId, tenantName }) {
  if (existingCustomerId) {
    try {
      const c = await stripe.customers.retrieve(existingCustomerId);
      if (c && !c.deleted) return existingCustomerId;
    } catch {
      // ignore -> create new
    }
  }

  const customer = await stripe.customers.create({
    name: tenantName || undefined,
    metadata: { tenantId: String(tenantId) },
  });

  await db.query("UPDATE tenants SET stripe_customer_id=? WHERE id=?", [customer.id, tenantId]);
  return customer.id;
}

/* =========================
   Routes
========================= */
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
    const hasSubscription = Boolean(t.stripe_subscription_id);
    const portalAvailable =
      stripeIsEnabled() &&
      Boolean(t.stripe_customer_id) &&
      Boolean(t.stripe_subscription_id) &&
      String(t.status || "active").toLowerCase() !== "canceled";   

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
        hasSubscription,
        portalAvailable,
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
 * ✅ 7-day trial ONLY for Starter (first time only)
 * ✅ Business/Pro = NO trial
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
      tenantName: t.name,
    });

    const isStarter = planKey === "starter";
    const isTrialEligible = isStarter && !t.trial_used_at;

    const metadata = { tenantId: String(tenantId), planKey, interval };

    const subscription_data = isTrialEligible
      ? { trial_period_days: 7, metadata }
      : { metadata };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: String(tenantId),
      payment_method_collection: "always",
      metadata,
      subscription_data,
    });

    // mark trial as used when we create a starter trial checkout session
    if (isTrialEligible) {
      await db.query("UPDATE tenants SET trial_used_at=NOW() WHERE id=? AND trial_used_at IS NULL", [tenantId]);
    }

    // optional audit
    await safeAudit(req, {
      action: "BILLING_CHECKOUT_CREATED",
      entity_type: "tenant",
      entity_id: tenantId,
      details: { planKey, interval, priceId },
      user_id: req.user?.id || null,
      user_email: req.user?.email || null,
      severity: SEVERITY.INFO,
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error("STRIPE CHECKOUT ERROR:", e);
    res.status(500).json({ message: "Stripe error" });
  }
});

/**
 * POST /api/billing/stripe/portal
 */
router.post("/stripe/portal", requireRole("owner"), requireBillingAdmin, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ message: "Stripe not configured" });

  try {
    const tenantId = req.tenantId;
    const t = await getTenantRow(tenantId);
    if (!t) return res.status(404).json({ message: "Tenant not found" });

    const front = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";

    let customerId = t.stripe_customer_id || null;

    async function createAndSaveCustomer() {
      const customer = await stripe.customers.create({
        name: t.name,
        metadata: { tenantId: String(t.id) },
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
        await createAndSaveCustomer();
      }
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${front}/billing`,
      configuration: process.env.STRIPE_PORTAL_CONFIG_ID || undefined,
    });

    res.json({ url: portal.url });
  } catch (e) {
    console.error("STRIPE PORTAL ERROR:", e);
    res.status(500).json({ message: "Stripe error" });
  }
});

router.post(
  "/stripe/portal-or-checkout",
  requireRole("owner"),
  requireBillingAdmin,
  async (req, res) => {
    const stripe = getStripe();
    if (!stripe) return res.status(400).json({ message: "Stripe not configured" });

    try {
      const tenantId = req.tenantId;
      const t = await getTenantRow(tenantId);
      if (!t) return res.status(404).json({ message: "Tenant not found" });

      const front = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";

      // Normalize optional plan/interval for "Subscribe" action
      const planKey = normalizePlanKey(req.body?.planKey || "business");
      const interval = normalizeInterval(req.body?.interval || "month");

      // Ensure customer exists (works across test/live mode mismatches)
      const customerId = await ensureStripeCustomer({
        stripe,
        tenantId,
        existingCustomerId: t.stripe_customer_id,
        tenantName: t.name,
      });

      const hasSubscription = Boolean(t.stripe_subscription_id);
      const isCanceled = String(t.status || "active").toLowerCase() === "canceled";

      // ✅ If active subscription exists and tenant isn't canceled, return portal
      if (hasSubscription && !isCanceled) {
        const portal = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${front}/billing`,
          configuration: process.env.STRIPE_PORTAL_CONFIG_ID,
        });
        return res.json({ kind: "portal", url: portal.url });
      }

      // ✅ Otherwise, return Checkout URL (Subscribe / Resubscribe)
      const priceId = priceIdForPlan(planKey, interval);
      if (!priceId) {
        return res.status(400).json({ message: `Missing Stripe price id for ${planKey} (${interval})` });
      }

      const successUrl = `${front}/billing?success=1`;
      const cancelUrl = `${front}/billing?canceled=1`;

      const isStarter = planKey === "starter";
      const isTrialEligible = isStarter && !t.trial_used_at;

      const metadata = { tenantId: String(tenantId), planKey, interval };
      const subscription_data = isTrialEligible
        ? { trial_period_days: 7, metadata }
        : { metadata };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        client_reference_id: String(tenantId),
        payment_method_collection: "always",
        metadata,
        subscription_data,
      });

      if (isTrialEligible) {
        await db.query("UPDATE tenants SET trial_used_at=NOW() WHERE id=? AND trial_used_at IS NULL", [tenantId]);
      }

      return res.json({ kind: "checkout", url: session.url });
    } catch (e) {
      console.error("PORTAL-OR-CHECKOUT ERROR:", e);
      return res.status(500).json({ message: "Stripe error" });
    }
  }
);

router.post("/stripe/sync", requireRole("owner"), requireBillingAdmin, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ message: "Stripe not configured" });

  try {
    const tenantId = req.tenantId;
    const t = await getTenantRow(tenantId);
    if (!t) return res.status(404).json({ message: "Tenant not found" });

    const customerId = t.stripe_customer_id || null;
    if (!customerId) return res.status(400).json({ message: "No Stripe customer on tenant" });

    // Find active subscription(s) for this customer
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
      expand: ["data.items.data.price"],
    });

    // Pick the most relevant sub: active > trialing > past_due > unpaid > canceled
    const rank = (s) => {
      const st = String(s.status || "");
      if (st === "active") return 1;
      if (st === "trialing") return 2;
      if (st === "past_due") return 3;
      if (st === "unpaid") return 4;
      return 99;
    };

    const best = (subs.data || []).slice().sort((a, b) => rank(a) - rank(b))[0];
    if (!best) return res.status(404).json({ message: "No subscriptions found for this customer" });

    const planKey = planKeyFromSubscription(best);
    const priceId = best.items?.data?.[0]?.price?.id || null;
    const plan_status = best.status || null;
    const status = mapTenantStatusFromStripe(plan_status);
    const periodEnd = best.current_period_end ? new Date(best.current_period_end * 1000) : null;

    await db.query(
      `UPDATE tenants
       SET
         plan_key=?,
         status=?,
         stripe_subscription_id=?,
         stripe_price_id=?,
         plan_status=?,
         current_period_end=?
       WHERE id=?`,
      [planKey, status, best.id, priceId, plan_status, periodEnd, tenantId]
    );

    res.json({
      ok: true,
      synced: {
        subscriptionId: best.id,
        planKey,
        status,
        plan_status,
        priceId,
      },
    });
  } catch (e) {
    console.error("STRIPE SYNC ERROR:", e?.message || e);
    res.status(500).json({ message: "Sync failed" });
  }
});

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
        unit_amount: p.unit_amount,
        recurring: p.recurring?.interval || null,
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
 * Webhook handler (your working version + checkout.session.completed binding)
 */
export async function billingWebhookHandler(req, res) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !secret) return res.status(400).send("Stripe webhook not configured");

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, secret, 300);
  } catch (e) {
    console.error("WEBHOOK SIGNATURE / REPLAY ERROR:", e?.message || e);
    // ✅ safer: ACK so Stripe stops retry spam
    return res.json({ received: true, rejected: "signature_or_replay" });
  }

  // idempotency row
  try {
    await db.query(
      `INSERT INTO stripe_webhook_events (event_id, type, livemode, status)
       VALUES (?, ?, ?, 'received')
       ON DUPLICATE KEY UPDATE event_id = event_id`,
      [event.id, event.type, event.livemode ? 1 : 0]
    );
  } catch (e) {
    console.error("WEBHOOK EVENT LOG INSERT ERROR (ack anyway):", e?.message || e);
    return res.json({ received: true });
  }

  // dedupe processed
  try {
    const [[row]] = await db.query(
      `SELECT status FROM stripe_webhook_events WHERE event_id=? LIMIT 1`,
      [event.id]
    );
    if (row?.status === "processed") return res.json({ received: true, deduped: true });
  } catch (e) {
    console.error("WEBHOOK EVENT STATUS READ ERROR:", e?.message || e);
  }

  res.json({ received: true });

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

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const tenantId =
          Number(session?.metadata?.tenantId || session?.metadata?.tenant_id || 0) || null;
        const customerId = session.customer || null;
        const subId = session.subscription || null;

        if (tenantId && customerId) {
          await db.query(
            `UPDATE tenants
             SET
               stripe_customer_id = COALESCE(stripe_customer_id, ?),
               stripe_subscription_id = COALESCE(stripe_subscription_id, ?)
             WHERE id=?`,
            [customerId, subId, tenantId]
          );
        }
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

router.get("/stripe/webhook/health", requireRole("owner", "admin"), requireBillingAdmin, async (req, res) => {
  try {
    const [[counts]] = await db.query(`
      SELECT
        SUM(status='received') AS received,
        SUM(status='processed') AS processed,
        SUM(status='failed') AS failed
      FROM stripe_webhook_events
    `);

    const [rows] = await db.query(
      `SELECT id, event_id, type, status, livemode, received_at, processed_at, LEFT(error_message, 180) AS err
       FROM stripe_webhook_events
       ORDER BY id DESC
       LIMIT 25`
    );

    res.json({
      ok: true,
      counts: {
        received: Number(counts?.received || 0),
        processed: Number(counts?.processed || 0),
        failed: Number(counts?.failed || 0),
      },
      last25: rows || [],
    });
  } catch (e) {
    console.error("WEBHOOK HEALTH ERROR:", e?.message || e);
    res.status(500).json({ ok: false, message: "DB error" });
  }
});

export default router;