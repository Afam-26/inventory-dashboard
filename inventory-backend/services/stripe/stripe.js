// utils/stripe.js (ESM-friendly)
import Stripe from "stripe";

let _stripe = null;

export function getStripe() {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  _stripe = new Stripe(key, { apiVersion: "2024-06-20" });
  return _stripe;
}

export function stripeIsEnabled() {
  return !!process.env.STRIPE_SECRET_KEY;
}
