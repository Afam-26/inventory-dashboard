// inventory-backend/services/stripe/client.js
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  throw new Error("Missing STRIPE_SECRET_KEY in environment");
}

// Keep apiVersion default unless you want to pin it.
// const stripe = new Stripe(key, { apiVersion: "2024-06-20" });
const stripe = new Stripe(key);

export default stripe;
