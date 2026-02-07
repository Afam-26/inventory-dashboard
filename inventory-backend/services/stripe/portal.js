// inventory-backend/services/stripe/portal.js
import stripe from "./client.js";

export async function createPortalSession({ tenant, returnUrl }) {
  if (!tenant?.stripe_customer_id) {
    throw new Error("Tenant has no stripe_customer_id");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripe_customer_id,
    return_url: returnUrl,
  });

  return session;
}
