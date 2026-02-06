// src/config/stripePlans.js
export const STRIPE_PRICE_TO_PLAN = {
  "price_xxxStarter": "starter",
  "price_xxxGrowth": "growth",
  "price_xxxPro": "pro",
};

export function planKeyFromSubscription(sub) {
  const priceId =
    sub?.items?.data?.[0]?.price?.id ||
    sub?.items?.data?.[0]?.plan?.id;
  return STRIPE_PRICE_TO_PLAN[priceId] || "starter";
}
