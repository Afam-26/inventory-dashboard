// inventory-frontend/src/services/billing.js
import {
  getPlans,
  getCurrentPlan,
  startStripeCheckout,
  openStripePortal,
  updateCurrentPlan,
  // ✅ add this import
  portalOrCheckout,
} from "./api";

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

export async function setPlanManually(planKey) {
  return updateCurrentPlan(planKey);
}

// ✅ new
export async function openPortalOrCheckout({ planKey, interval }) {
  return portalOrCheckout({ planKey, interval });
}