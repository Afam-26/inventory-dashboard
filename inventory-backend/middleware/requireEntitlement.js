// inventory-backend/middleware/requireEntitlement.js
import { getTenantEntitlements } from "../config/plans.js";

/**
 * Enforce that tenant has a specific feature enabled.
 */
export function requireFeature(featureKey) {
  return (req, res, next) => {
    const ent = getTenantEntitlements(req.tenant);
    const ok = !!ent?.features?.[featureKey];

    if (!ok) {
      return res.status(402).json({
        error: "Plan upgrade required",
        code: "PLAN_UPGRADE_REQUIRED",
        feature: featureKey,
        plan: ent.key,
      });
    }
    next();
  };
}

/**
 * Enforce tenant usage does not exceed a plan limit.
 * Pass an async function that returns the current usage count (number).
 *
 * Example:
 * requireLimit("products", async (req) => {
 *   const [rows] = await db.query("SELECT COUNT(*) AS n FROM products WHERE tenant_id=?", [req.tenant.id]);
 *   return rows[0].n;
 * })
 */
export function requireLimit(limitKey, getCurrent) {
  return async (req, res, next) => {
    const ent = getTenantEntitlements(req.tenant);
    const limit = ent?.limits?.[limitKey];

    if (limit == null) return next();

    try {
      const current = await getCurrent(req);

      if (Number(current) >= Number(limit)) {
        return res.status(402).json({
          error: "Plan limit reached",
          code: "PLAN_LIMIT_REACHED",
          limitKey,
          limit,
          current,
          plan: ent.key,
        });
      }

      next();
    } catch (e) {
      console.error("requireLimit error:", e);
      return res.status(500).json({ error: "Failed to check plan limit" });
    }
  };
}
