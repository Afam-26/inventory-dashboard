// inventory-backend/services/stripe/prices.js

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in environment`);
  return v;
}

export const PLAN_TO_PRICE = {
  starter: must("STRIPE_PRICE_STARTER"),
  growth: must("STRIPE_PRICE_GROWTH"),
  pro: must("STRIPE_PRICE_PRO"),
};

export const PRICE_TO_PLAN = Object.fromEntries(
  Object.entries(PLAN_TO_PRICE).map(([plan, price]) => [price, plan])
);

export function normalizePlanKey(planKey) {
  const k = String(planKey || "").toLowerCase();
  if (!["starter", "growth", "pro"].includes(k)) return "starter";
  return k;
}
