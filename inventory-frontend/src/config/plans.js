// src/config/plans.js
// UI-only: display labels + ordering + highlights.
// Backend remains source of truth for actual entitlements.

export const UI_PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: "$19/mo",
    tagline: "For solo & small shops",
    bullets: [
      "1 location",
      "Up to 1,000 products",
      "Basic low-stock alerts",
      "Audit logs (7 days)",
    ],
    cta: "Choose Starter",
  },
  {
    key: "growth",
    name: "Growth",
    price: "$49/mo",
    tagline: "Best for growing teams",
    highlight: true,
    bullets: [
      "Up to 3 locations",
      "Up to 10,000 products",
      "Barcode + scan workflows",
      "Stock reconcile + drift tracking",
      "Invite users (up to 5)",
      "Audit logs (90 days)",
    ],
    cta: "Upgrade to Growth",
  },
  {
    key: "pro",
    name: "Pro",
    price: "$99/mo",
    tagline: "For multi-location operations",
    bullets: [
      "Up to 10 locations",
      "Up to 50,000 products",
      "25 users (or more)",
      "Advanced controls & longer retention",
      "Audit logs (1 year)",
    ],
    cta: "Upgrade to Pro",
  },
];

export function planRank(planKey) {
  const k = String(planKey || "").toLowerCase();
  if (k === "starter") return 1;
  if (k === "growth") return 2;
  if (k === "pro") return 3;
  return 0;
}
