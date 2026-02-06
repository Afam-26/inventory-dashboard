// src/config/plans.js
export const PLANS = {
  starter: {
    key: "starter",
    name: "Starter",
    limits: {
      locations: 1,
      products: 1000,
      users: 1,
      auditDays: 7,
    },
    features: {
      barcode: false,
      reconcile: false,
      invites: false,
      advancedAlerts: false,
      branding: false,
    },
  },
  growth: {
    key: "growth",
    name: "Growth",
    limits: {
      locations: 3,
      products: 10000,
      users: 5,
      auditDays: 90,
    },
    features: {
      barcode: true,
      reconcile: true,
      invites: true,
      advancedAlerts: true,
      branding: true,
    },
  },
  pro: {
    key: "pro",
    name: "Pro",
    limits: {
      locations: 10,
      products: 50000,
      users: 25, // or Infinity
      auditDays: 365,
    },
    features: {
      barcode: true,
      reconcile: true,
      invites: true,
      advancedAlerts: true,
      branding: true,
    },
  },
};

export function getTenantEntitlements(tenant) {
  const planKey = tenant?.plan_key || "starter";
  return PLANS[planKey] || PLANS.starter;
}
