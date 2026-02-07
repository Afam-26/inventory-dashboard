// inventory-backend/services/stripe/webhooks.js
import stripe from "./client.js";
import {
  findTenantIdByCustomerId,
  findTenantIdBySubscriptionId,
  setTenantCanceledBySubscriptionId,
  upsertTenantBillingFromSubscription,
} from "./syncTenant.js";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!webhookSecret) {
  throw new Error("Missing STRIPE_WEBHOOK_SECRET in environment");
}

export function constructEvent(rawBodyBuffer, signature) {
  return stripe.webhooks.constructEvent(rawBodyBuffer, signature, webhookSecret);
}

async function getSubscriptionObject(event) {
  const obj = event.data.object;
  // Sometimes event object is already a subscription; sometimes you need to fetch.
  if (obj?.object === "subscription") return obj;
  if (obj?.subscription) {
    // invoice.* events contain subscription id
    const subId = obj.subscription;
    return await stripe.subscriptions.retrieve(subId);
  }
  return null;
}

export async function handleStripeEvent(event) {
  const type = event.type;

  if (
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated" ||
    type === "invoice.payment_succeeded" ||
    type === "invoice.payment_failed"
  ) {
    const subscription = await getSubscriptionObject(event);
    if (!subscription) return { ok: true, ignored: true, reason: "no subscription" };

    const customerId = subscription.customer;
    let tenantId = await findTenantIdBySubscriptionId(subscription.id);

    if (!tenantId) tenantId = await findTenantIdByCustomerId(customerId);
    if (!tenantId) {
      return { ok: true, ignored: true, reason: "tenant not found" };
    }

    const updated = await upsertTenantBillingFromSubscription({
      tenantId,
      customerId,
      subscription,
    });

    return { ok: true, updated };
  }

  if (type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const subId = sub?.id;
    if (subId) await setTenantCanceledBySubscriptionId(subId);
    return { ok: true, canceled: true };
  }

  if (type === "checkout.session.completed") {
    // Optional: you can rely on subscription.updated events instead.
    return { ok: true, received: true };
  }

  return { ok: true, ignored: true };
}
