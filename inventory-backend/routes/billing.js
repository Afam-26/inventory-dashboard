// routes/billing.js
import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";
import { requireBillingAdmin } from "../middleware/billing.js";
import { PLANS, normalizePlanKey, makeUsageLine } from "../utils/plans.js";
import { logAudit, SEVERITY } from "../utils/audit.js";
import { getStripe, stripeIsEnabled } from "../services/stripe/stripe.js";

const router = express.Router();

// must have tenant context
router.use(requireAuth, requireTenant);

// helper: current plan from tenant
async function getTenantPlan(tenantId) {
  const [[t]] = await db.query(
    "SELECT id, plan_key, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan_status, current_period_end FROM tenants WHERE id=? LIMIT 1",
    [tenantId]
  );
  const planKey = normalizePlanKey(t?.plan_key);
  return { ...t, planKey, plan: PLANS[planKey] };
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

/**
 * GET /api/billing/plans
 * anyone in tenant can view
 */
router.get("/plans", async (req, res) => {
  res.json({
    plans: Object.values(PLANS).map((p) => ({
      key: p.key,
      name: p.name,
      priceLabel: p.priceLabel,
      limits: {
        categories: p.limits.categories === Infinity ? null : p.limits.categories,
        products: p.limits.products === Infinity ? null : p.limits.products,
        users: p.limits.users === Infinity ? null : p.limits.users,
      },
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

    const limits = t.plan.limits;

    res.json({
      tenantId,
      planKey: t.planKey,
      planName: t.plan.name,
      priceLabel: t.plan.priceLabel,
      stripe: {
        enabled: stripeIsEnabled(),
        customerId: t.stripe_customer_id || null,
        subscriptionId: t.stripe_subscription_id || null,
        status: t.plan_status || null,
        currentPeriodEnd: t.current_period_end || null,
      },
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
 */
router.post("/stripe/checkout", requireRole("owner"), requireBillingAdmin, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).json({ message: "Stripe not configured" });

  try {
    const tenantId = req.tenantId;
    const t = await getTenantPlan(tenantId);

    const planKey = normalizePlanKey(req.body?.planKey);
    const priceId = String(req.body?.priceId || "").trim();
    if (!priceId) return res.status(400).json({ message: "priceId is required" });

    const front = process.env.FRONTEND_URL || "http://localhost:5173";
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

    const front = process.env.FRONTEND_URL || "http://localhost:5173";

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
    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const sub = event.data.object;
      const customerId = sub.customer;

      const priceId = sub.items?.data?.[0]?.price?.id || null;
      const status = sub.status || null;
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;

      const [[t]] = await db.query("SELECT id FROM tenants WHERE stripe_customer_id=? LIMIT 1", [customerId]);
      if (t?.id) {
        await db.query(
          `UPDATE tenants
           SET stripe_subscription_id=?, stripe_price_id=?, plan_status=?, current_period_end=?
           WHERE id=?`,
          [sub.id, priceId, status, periodEnd, t.id]
        );
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const customerId = sub.customer;
      const [[t]] = await db.query("SELECT id FROM tenants WHERE stripe_customer_id=? LIMIT 1", [customerId]);
      if (t?.id) {
        await db.query(
          `UPDATE tenants
           SET plan_key='starter', stripe_subscription_id=NULL, stripe_price_id=NULL, plan_status=?, current_period_end=NULL
           WHERE id=?`,
          [sub.status || "canceled", t.id]
        );
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error("WEBHOOK PROCESS ERROR:", e);
    res.status(500).send("Webhook error");
  }
}

export default router;
