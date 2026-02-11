// inventory-backend/config/stripePlans.js
// Monthly + Yearly price mapping + subscription -> plan mapping

function env(name) {
  return String(process.env[name] || "").trim();
}

export function normalizePlanKey(planKey) {
  const k = String(planKey || "").toLowerCase().trim();
  if (!["starter", "growth", "pro"].includes(k)) return "starter";
  return k;
}

export function normalizeInterval(interval) {
  const v = String(interval || "").toLowerCase().trim();
  if (v === "year" || v === "yearly" || v === "annual") return "year";
  return "month";
}

/**
 * Put these in inventory-backend/.env
 *
 * STRIPE_PRICE_STARTER_MONTHLY=price_...
 * STRIPE_PRICE_STARTER_YEARLY=price_...
 * STRIPE_PRICE_GROWTH_MONTHLY=price_...
 * STRIPE_PRICE_GROWTH_YEARLY=price_...
 * STRIPE_PRICE_PRO_MONTHLY=price_...
 * STRIPE_PRICE_PRO_YEARLY=price_...
 */
export const PLAN_INTERVAL_TO_PRICE = {
  starter: {
    month: env("STRIPE_PRICE_STARTER_MONTHLY"),
    year: env("STRIPE_PRICE_STARTER_YEARLY"),
  },
  growth: {
    month: env("STRIPE_PRICE_GROWTH_MONTHLY"),
    year: env("STRIPE_PRICE_GROWTH_YEARLY"),
  },
  pro: {
    month: env("STRIPE_PRICE_PRO_MONTHLY"),
    year: env("STRIPE_PRICE_PRO_YEARLY"),
  },
};

export function priceIdForPlan(planKey, interval = "month") {
  const k = normalizePlanKey(planKey);
  const i = normalizeInterval(interval);
  return PLAN_INTERVAL_TO_PRICE?.[k]?.[i] || "";
}

/** Reverse lookup: Stripe priceId -> {planKey, interval} */
export const STRIPE_PRICE_TO_META = (() => {
  const out = {};
  for (const [planKey, intervals] of Object.entries(PLAN_INTERVAL_TO_PRICE)) {
    for (const [interval, priceId] of Object.entries(intervals || {})) {
      if (priceId) out[priceId] = { planKey, interval };
    }
  }
  return out;
})();

export function planKeyFromSubscription(sub) {
  const priceId =
    sub?.items?.data?.[0]?.price?.id ||
    sub?.items?.data?.[0]?.plan?.id ||
    "";

  const meta = STRIPE_PRICE_TO_META[priceId];
  return normalizePlanKey(meta?.planKey || "starter");
}

export function intervalFromSubscription(sub) {
  const priceId =
    sub?.items?.data?.[0]?.price?.id ||
    sub?.items?.data?.[0]?.plan?.id ||
    "";

  const meta = STRIPE_PRICE_TO_META[priceId];
  return normalizeInterval(meta?.interval || "month");
}
