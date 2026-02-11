// inventory-backend/config/plans.js

export const PLANS = {
  starter: {
    key: "starter",
    name: "Starter",
    limits: {
      categories: 3,
      products: 1000,
      users: 3,
      auditDays: 30,
    },
    features: {
      barcode: true,
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
      categories: 5,
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
      categories: 10,
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
  const planKey = String(tenant?.plan_key || "starter").toLowerCase(); 
  return PLANS[planKey] || PLANS.starter;
}
