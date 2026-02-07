// inventory-backend/services/stripe/checkout.js
import stripe from "./client.js";
import { PLAN_TO_PRICE, normalizePlanKey } from "./prices.js";

export async function createCheckoutSession({
  tenant,
  user,
  planKey,
  successUrl,
  cancelUrl,
}) {
  const normalized = normalizePlanKey(planKey);
  const priceId = PLAN_TO_PRICE[normalized];

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: tenant?.stripe_customer_id || undefined,
    client_reference_id: String(tenant.id),
    metadata: {
      tenant_id: String(tenant.id),
      plan_key: normalized,
      user_email: user?.email ? String(user.email) : "",
    },
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
  });

  return session;
}
