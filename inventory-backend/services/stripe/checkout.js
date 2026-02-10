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

  // ensure customer exists
  let customerId = t.stripe_customer_id;

  if (customerId) {
    try {
      // Verify customer exists in the current Stripe mode
      await stripe.customers.retrieve(customerId);
    } catch (e) {
      // If not found, reset it so we create a fresh one
      customerId = null;
      await db.query("UPDATE tenants SET stripe_customer_id=NULL WHERE id=?", [tenantId]);
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { tenantId: String(tenantId) },
    });
    customerId = customer.id;
    await db.query("UPDATE tenants SET stripe_customer_id=? WHERE id=?", [customerId, tenantId]);
  }


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
