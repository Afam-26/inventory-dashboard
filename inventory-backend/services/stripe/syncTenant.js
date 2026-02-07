// inventory-backend/services/stripe/syncTenant.js
import { db } from "../../config/db.js";
import { PRICE_TO_PLAN } from "./prices.js";

function planFromSub(sub) {
  const priceId = sub?.items?.data?.[0]?.price?.id;
  return PRICE_TO_PLAN[priceId] || "starter";
}

function mapStatus(stripeSubStatus) {
  // Stripe statuses include: active, trialing, past_due, canceled, unpaid, incomplete, incomplete_expired, paused
  if (stripeSubStatus === "active" || stripeSubStatus === "trialing") return "active";
  if (stripeSubStatus === "past_due" || stripeSubStatus === "unpaid") return "past_due";
  return "canceled";
}

export async function upsertTenantBillingFromSubscription({
  tenantId,
  customerId,
  subscription,
}) {
  const plan_key = planFromSub(subscription);
  const status = mapStatus(subscription?.status);

  const stripe_subscription_id = subscription?.id || null;
  const stripe_customer_id = customerId || subscription?.customer || null;
  const stripe_price_id = subscription?.items?.data?.[0]?.price?.id || null;

  const current_period_end = subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  await db.query(
    `
    UPDATE tenants
    SET
      plan_key = ?,
      status = ?,
      stripe_customer_id = ?,
      stripe_subscription_id = ?,
      stripe_price_id = ?,
      plan_status = ?,
      current_period_end = ?
    WHERE id = ?
    `,
    [
      plan_key,
      status,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_price_id,
      subscription?.status || null,
      current_period_end,
      tenantId,
    ]
  );

  return { plan_key, status, stripe_price_id, current_period_end };
}

export async function setTenantCanceledBySubscriptionId(subscriptionId) {
  await db.query(
    `
    UPDATE tenants
    SET
      status = 'canceled',
      plan_status = 'canceled'
    WHERE stripe_subscription_id = ?
    `,
    [subscriptionId]
  );
}

export async function findTenantIdByCustomerId(customerId) {
  const [rows] = await db.query(
    `SELECT id FROM tenants WHERE stripe_customer_id = ? LIMIT 1`,
    [customerId]
  );
  return rows?.[0]?.id || null;
}

export async function findTenantIdBySubscriptionId(subscriptionId) {
  const [rows] = await db.query(
    `SELECT id FROM tenants WHERE stripe_subscription_id = ? LIMIT 1`,
    [subscriptionId]
  );
  return rows?.[0]?.id || null;
}
