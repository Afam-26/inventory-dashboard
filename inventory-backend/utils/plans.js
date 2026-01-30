// utils/plans.js
export const PLANS = Object.freeze({
  starter: {
    key: "starter",
    name: "Starter",
    priceLabel: "$0",
    limits: { categories: 100, products: 200, users: 3 },
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceLabel: "$19/mo",
    limits: { categories: 200, products: 2000, users: 10 },
  },
  business: {
    key: "business",
    name: "Business",
    priceLabel: "$49/mo",
    limits: { categories: Infinity, products: Infinity, users: Infinity },
  },
});

export function normalizePlanKey(planKey) {
  const k = String(planKey || "starter").toLowerCase();
  return PLANS[k] ? k : "starter";
}

export function limitToNumber(limit) {
  return limit === Infinity ? null : Number(limit);
}

export function makeUsageLine({ used, limit }) {
  const lim = limit === Infinity ? null : Number(limit);
  const pct = lim ? Math.min(100, Math.round((Number(used || 0) / lim) * 100)) : null;
  return {
    used: Number(used || 0),
    limit: lim,          // null = unlimited
    percent: pct,        // null = unlimited
    unlimited: lim == null,
  };
}
