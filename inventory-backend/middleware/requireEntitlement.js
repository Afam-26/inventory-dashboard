// src/middleware/requireEntitlement.js
import { getTenantEntitlements } from "../config/plans.js";

export function requireFeature(featureKey) {
  return (req, res, next) => {
    const ent = getTenantEntitlements(req.tenant);
    if (!ent.features?.[featureKey]) {
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

export function requireLimit(limitKey, currentValueGetter) {
  return (req, res, next) => {
    const ent = getTenantEntitlements(req.tenant);
    const limit = ent.limits?.[limitKey];

    if (limit == null) return next(); // no limit
    const current = currentValueGetter(req);

    if (current >= limit) {
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
  };
}
