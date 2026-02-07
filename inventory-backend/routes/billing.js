// routes/billing.js
import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";
import { requireBillingAdmin } from "../middleware/billing.js";
import { PLANS, getTenantEntitlements } from "../config/plans.js";
import {
  normalizePlanKey,
  planKeyFromSubscription,
  priceIdForPlan,
} from "../config/stripePlans.js";
import { logAudit, SEVERITY } from "../utils/audit.js";
import { getStripe, stripeIsEnabled } from "../services/stripe/stripe.js";

const router = express.Router();

// must have tenant context
router.use(requireAuth, requireTenant);

// helper: current plan from tenant
async function getTenantPlan(tenantId) {
  const [[t]] = await db.query(
    "SELECT id, plan_key, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan_status, current_period_end FROM tenants WHERE id=? LIMIT 1",
    [tenantId]
  );
  const planKey = normalizePlanKey(t?.plan_key);
  return { ...t, planKey, plan: PLANS[planKey] || PLANS.starter };
}

async function getTenantUsage(tenantId) {
  const [[cat]] = await db.query(
    `SELECT COUNT(*) AS c FROM categories WHERE tenant_id=? AND deleted_at IS NULL`,
    [tenantId]
  );

  const [[prod]] = await db.query(
    `SELECT COUNT(*) AS c FROM products WHERE tenant_id=?`,
    [tenantId]
  );

  const [[users]] = await db.query(
    `SELECT COUNT(*) AS c
     FROM tenant_members
     WHERE tenant_id=? AND status='active'`,
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

/**
 * GET /api/billing/plans
 * anyone in tenant can view
 */
router.get("/plans", async (req, res) => {
  res.json({
    plans: Object.values(PLANS).map((p) => ({
      key: p.key,
      name: p.name,
      priceLabel: p.priceLabel || null,
      limits: {
        locations: p.limits?.locations ?? null,
        products: p.limits?.products ?? null,
        users: p.limits?.users ?? null,
        auditDays: p.limits?.auditDays ?? null,
      },
      features: p.features || {},
    })),
    stripeEnabled: stripeIsEnabled(),
  });
});

/**
 * GET /api/billing/current
 * anyone in tenant can view current plan + usage meters
 */
router.get("/current", async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const t = await getTenantPlan(tenantId);
    const usage = await getTenantUsage(tenantId);
    const ent = getTenantEntitlements(t);

    const limits = ent?.limits || {};

    res.json({
      tenantId,
      planKey: t.planKey,
      planName: t.plan?.name || t.planKey,
      priceLabel: t.plan?.priceLabel || null,
      tenantStatus: t.status || "active",
      stripe: {
        enabled: stripeIsEnabled(),
        customerId: t.stripe_customer_id || null,
        subscriptionId: t.stripe_subscription_id || null,
        status: t.plan_status || null,
        currentPeriodEnd: t.current_period_end || null,
        priceId: t.stripe_price_id || null,
      },
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
 * POST /api/billing/change-plan
 * ✅ OWNER ONLY
 * Manual override (useful when Stripe is disabled)
 */
router.post("/change-plan", requireRole("owner"), requireBillingAdmin, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const requested = normalizePlanKey(req.body?.planKey);

    await db.query("UPDATE tenants SET plan_key=? WHERE id=?", [requested, tenantId]);

    try {
      await logAudit(req, {
        action: "PLAN_CHANGED",
        entity_type: "tenant",
        entity_id: tenantId,
        details: { planKey: requested },
        user_id: req.user?.id ?? null,
        user_email: req.user?.email ?? null,
        severity: SEVERITY.INFO,
      });
    } catch {}

    res.json({ message: "Plan updated", planKey: requested });
  } catch (e) {
    console.error("BILLING CHANGE PLAN ERROR:", e);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * POST /api/billing/stripe/checkout
 * ✅ OWNER ONLY
 * Body: { planKey }
 * We DO NOT accept priceId from frontend anymore.
 */
router.post("/stripe/checkout", requireRole("owner"), requireBillingAdmin, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ message: "Stripe not configured" });

  try {
    const tenantId = req.tenantId;
    const t = await getTenantPlan(tenantId);

    const planKey = normalizePlanKey(req.body?.planKey);
    const priceId = priceIdForPlan(planKey);
    if (!priceId) return res.status(400).json({ message: `Missing Stripe price id for plan ${planKey}` });

    const front = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";
    const successUrl = `${front}/billing?success=1`;
    const cancelUrl = `${front}/billing?canceled=1`;

    // ensure customer exists
    let customerId = t.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { tenantId: String(tenantId) },
      });
      customerId = customer.id;
      await db.query("UPDATE tenants SET stripe_customer_id=? WHERE id=?", [customerId, tenantId]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: String(tenantId),
      metadata: { tenantId: String(tenantId), planKey },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error("STRIPE CHECKOUT ERROR:", e);
    res.status(500).json({ message: "Stripe error" });
  }
});

/**
 * POST /api/billing/stripe/portal
 * ✅ OWNER ONLY
 */
router.post("/stripe/portal", requireRole("owner"), requireBillingAdmin, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ message: "Stripe not configured" });

  try {
    const tenantId = req.tenantId;
    const t = await getTenantPlan(tenantId);
    if (!t.stripe_customer_id) return res.status(400).json({ message: "No Stripe customer" });

    const front = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";

    const portal = await stripe.billingPortal.sessions.create({
      customer: t.stripe_customer_id,
      return_url: `${front}/billing`,
    });

    res.json({ url: portal.url });
  } catch (e) {
    console.error("STRIPE PORTAL ERROR:", e);
    res.status(500).json({ message: "Stripe error" });
  }
});

/**
 * POST /api/billing/stripe/webhook
 * Exported handler so server.js can mount it with express.raw()
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

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.created"
    ) {
      const sub = event.data.object;

      const customerId = sub.customer;
      const planKey = planKeyFromSubscription(sub);
      const priceId = sub.items?.data?.[0]?.price?.id || null;

      const plan_status = sub.status || null;
      const status = mapTenantStatusFromStripe(plan_status);
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;

      const tenantId = await resolveTenantId({
        subId: sub.id,
        customerId,
        metadata: sub.metadata,
      });

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

      return res.json({ received: true });
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const customerId = sub.customer;

      const tenantId = await resolveTenantId({
        subId: sub.id,
        customerId,
        metadata: sub.metadata,
      });

      if (tenantId) {
        await db.query(
          `UPDATE tenants
           SET
             status='canceled',
             plan_status=?,
             current_period_end=NULL
           WHERE id=?`,
          [sub.status || "canceled", tenantId]
        );
      }

      return res.json({ received: true });
    }

    // Optional invoice events
    if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      const subId = inv.subscription || null;

      if (subId) {
        const subscription = await stripe.subscriptions.retrieve(subId);
        const customerId = subscription.customer;

        const planKey = planKeyFromSubscription(subscription);
        const priceId = subscription.items?.data?.[0]?.price?.id || null;

        const plan_status = subscription.status || null;
        const status = mapTenantStatusFromStripe(plan_status);
        const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null;

        const tenantId = await resolveTenantId({
          subId: subscription.id,
          customerId,
          metadata: subscription.metadata,
        });

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
            [planKey, status, customerId, subscription.id, priceId, plan_status, periodEnd, tenantId]
          );
        }
      }

      return res.json({ received: true });
    }

    return res.json({ received: true });
  } catch (e) {
    console.error("WEBHOOK PROCESS ERROR:", e);
    res.status(500).send("Webhook error");
  }
}

export default router;
