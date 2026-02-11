// inventory-frontend/src/services/billing.js
import { getPlans, getCurrentPlan, startStripeCheckout, openStripePortal, updateCurrentPlan } from "./api";

/**
 * Simple wrapper so Billing.jsx stays clean.
 */
export async function fetchBillingPlans() {
  return getPlans();
}

export async function fetchBillingCurrent() {
  return getCurrentPlan();
}

export async function beginCheckout({ planKey, interval }) {
  return startStripeCheckout({ planKey, interval });
}

export async function openBillingPortal() {
  return openStripePortal();
}

// optional: manual plan override when Stripe disabled
export async function setPlanManually(planKey) {
  return updateCurrentPlan(planKey);
}
