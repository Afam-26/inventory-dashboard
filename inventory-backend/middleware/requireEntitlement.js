// inventory-backend/middleware/requireEntitlements.js
import { db } from "../config/db.js";
import { getTenantEntitlements } from "../config/plans.js";

/**
 * Loads tenant row from DB (single source of truth)
 * We DO NOT assume req.tenant exists.
 */
async function loadTenantById(tenantId) {
  const id = Number(tenantId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const [[t]] = await db.query(
    "SELECT id, plan_key, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan_status, current_period_end FROM tenants WHERE id=? LIMIT 1",
    [id]
  );

  return t || null;
}

/**
 * Optional: Enforce subscription status rules
 * - active/trialing => ok
 * - past_due => soft-block (configurable)
 * - canceled => hard-block
 */
function statusGate(tenant, { blockPastDue = false } = {}) {
  const st = String(tenant?.status || "active").toLowerCase();

  if (st === "canceled") {
    return { ok: false, http: 402, message: "Subscription canceled", code: "SUBSCRIPTION_CANCELED" };
  }

  if (blockPastDue && st === "past_due") {
    return { ok: false, http: 402, message: "Subscription past due", code: "SUBSCRIPTION_PAST_DUE" };
  }

  return { ok: true };
}

/**
 * Attach tenant + entitlements to request
 * Useful if multiple middleware need the entitlements.
 */
export function attachEntitlements() {
  return async (req, res, next) => {
    try {
      const tenantId = req.tenantId;
      const tenant = await loadTenantById(tenantId);
      if (!tenant) return res.status(400).json({ message: "Tenant not found" });

      req.tenant = tenant; // attach
      req.entitlements = getTenantEntitlements(tenant);
      next();
    } catch (e) {
      console.error("attachEntitlements error:", e);
      res.status(500).json({ message: "Server error" });
    }
  };
}

/**
 * Require a feature flag: barcode/reconcile/invites/advancedAlerts/branding
 *
 * Options:
 * - blockPastDue: if true, past_due tenants are blocked (402)
 */
export function requireFeature(featureKey, { blockPastDue = false } = {}) {
  return async (req, res, next) => {
    try {
      const tenant = req.tenant || (await loadTenantById(req.tenantId));
      if (!tenant) return res.status(400).json({ message: "Tenant not found" });

      const gate = statusGate(tenant, { blockPastDue });
      if (!gate.ok) return res.status(gate.http).json({ message: gate.message, code: gate.code });

      const ent = req.entitlements || getTenantEntitlements(tenant);

      if (!ent?.features?.[featureKey]) {
        return res.status(403).json({
          message: `Feature not available on your plan: ${featureKey}`,
          code: "FEATURE_NOT_AVAILABLE",
          feature: featureKey,
          plan: ent?.key || tenant.plan_key || "starter",
        });
      }

      req.tenant = tenant;
      req.entitlements = ent;
      next();
    } catch (e) {
      console.error("requireFeature error:", e);
      res.status(500).json({ message: "Server error" });
    }
  };
}

/**
 * Enforce tenant usage does not exceed a plan limit.
 *
 * Pass an async function that returns the current usage count (number).
 * It blocks ONLY when attempting to CREATE more (>= limit).
 *
 * Options:
 * - blockPastDue: if true, past_due tenants are blocked from creating (402)
 *
 * Example:
 * requireLimit("products", async (req) => {
 *   const [[r]] = await db.query("SELECT COUNT(*) AS n FROM products WHERE tenant_id=?", [req.tenantId]);
 *   return r?.n || 0;
 * })
 */
export function requireLimit(limitKey, getCurrent, { blockPastDue = false } = {}) {
  return async (req, res, next) => {
    try {
      const tenant = req.tenant || (await loadTenantById(req.tenantId));
      if (!tenant) return res.status(400).json({ message: "Tenant not found" });

      const gate = statusGate(tenant, { blockPastDue });
      if (!gate.ok) return res.status(gate.http).json({ message: gate.message, code: gate.code });

      const ent = req.entitlements || getTenantEntitlements(tenant);
      const limit = ent?.limits?.[limitKey];

      // null/undefined/Infinity => unlimited
      if (limit == null || limit === Infinity) {
        req.tenant = tenant;
        req.entitlements = ent;
        return next();
      }

      const current = Number(await getCurrent(req));
      const lim = Number(limit);

      if (Number.isFinite(current) && Number.isFinite(lim) && current >= lim) {
        return res.status(402).json({
          message: "Plan limit reached",
          code: "PLAN_LIMIT_REACHED",
          limitKey,
          limit: lim,
          current,
          plan: ent?.key || tenant.plan_key || "starter",
        });
      }

      req.tenant = tenant;
      req.entitlements = ent;
      next();
    } catch (e) {
      console.error("requireLimit error:", e);
      return res.status(500).json({ message: "Failed to check plan limit" });
    }
  };
}

/**
 * Convenience: block writes if tenant is past_due/canceled.
 * Use for "create/update/delete" routes where you want a billing lock.
 */
export function requireActiveSubscription({ allowPastDue = true } = {}) {
  return async (req, res, next) => {
    try {
      const tenant = req.tenant || (await loadTenantById(req.tenantId));
      if (!tenant) return res.status(400).json({ message: "Tenant not found" });

      const st = String(tenant.status || "active").toLowerCase();

      if (st === "canceled") {
        return res.status(402).json({ message: "Subscription canceled", code: "SUBSCRIPTION_CANCELED" });
      }

      if (!allowPastDue && st === "past_due") {
        return res.status(402).json({ message: "Subscription past due", code: "SUBSCRIPTION_PAST_DUE" });
      }

      req.tenant = tenant;
      req.entitlements = req.entitlements || getTenantEntitlements(tenant);
      next();
    } catch (e) {
      console.error("requireActiveSubscription error:", e);
      res.status(500).json({ message: "Server error" });
    }
  };
}
