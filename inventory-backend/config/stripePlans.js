// inventory-backend/config/stripePlans.js

function env(name) {
  return String(process.env[name] || "").trim();
}

// Preferred: set these in .env
// STRIPE_PRICE_STARTER=price_...
// STRIPE_PRICE_GROWTH=price_...
// STRIPE_PRICE_PRO=price_...
export const PLAN_TO_PRICE = {
  starter: env("STRIPE_PRICE_STARTER"),
  growth: env("STRIPE_PRICE_GROWTH"),
  pro: env("STRIPE_PRICE_PRO"),
};

// Fallback: if you prefer hardcoding (not recommended), you can set them here too.
// export const PLAN_TO_PRICE = {
//   starter: "price_xxxStarter",
//   growth: "price_xxxGrowth",
//   pro: "price_xxxPro",
// };

export const STRIPE_PRICE_TO_PLAN = Object.fromEntries(
  Object.entries(PLAN_TO_PRICE)
    .filter(([, priceId]) => !!priceId)
    .map(([planKey, priceId]) => [priceId, planKey])
);

export function normalizePlanKey(planKey) {
  const k = String(planKey || "").toLowerCase().trim();
  if (!["starter", "growth", "pro"].includes(k)) return "starter";
  return k;
}

export function planKeyFromSubscription(sub) {
  const priceId =
    sub?.items?.data?.[0]?.price?.id ||
    sub?.items?.data?.[0]?.plan?.id;

  return STRIPE_PRICE_TO_PLAN[priceId] || "starter";
}

export function priceIdForPlan(planKey) {
  const k = normalizePlanKey(planKey);
  return PLAN_TO_PRICE[k] || "";
}
