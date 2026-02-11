// inventory-frontend/src/utils/planUi.js

export function getPlanBannerFromCurrent(current) {
  const tenantStatus = String(current?.tenantStatus || "active").toLowerCase();
  const stripeStatus = String(current?.stripe?.status || "").toLowerCase();

  // past_due should block “paid” features if you want
  if (tenantStatus === "past_due" || stripeStatus === "past_due" || stripeStatus === "unpaid") {
    return {
      tone: "warn",
      title: "Payment issue",
      message:
        "Your subscription is past due. Some features may be disabled until payment is updated.",
      ctaLabel: "Manage billing",
      ctaHref: "/billing",
    };
  }

  if (tenantStatus === "canceled") {
    return {
      tone: "danger",
      title: "Subscription canceled",
      message: "Your subscription is canceled. Please upgrade to continue using paid features.",
      ctaLabel: "View plans",
      ctaHref: "/billing",
    };
  }

  return null;
}

/**
 * Convert backend plan errors into a friendly banner.
 * Your backend requireLimit returns:
 *  - status 402
 *  - code: PLAN_LIMIT_REACHED
 *
 * Your requireFeature may return:
 *  - status 403, message includes "Feature not available..."
 */
export function getPlanBannerFromApiError(err) {
  const status = Number(err?.status || 0);
  const code = String(err?.code || "").toUpperCase();
  const msg = String(err?.message || "");

  if (status === 402 && code === "PLAN_LIMIT_REACHED") {
    const limitKey = err?.limitKey ? String(err.limitKey) : "this";
    return {
      tone: "warn",
      title: "Plan limit reached",
      message: `You’ve reached your plan limit for ${limitKey}. Upgrade to add more.`,
      ctaLabel: "Upgrade",
      ctaHref: "/billing",
    };
  }

  // some of your routes return 402 for subscription status
  if (status === 402 && msg.toLowerCase().includes("past due")) {
    return {
      tone: "warn",
      title: "Payment issue",
      message: "Your subscription is past due. Please update payment to continue.",
      ctaLabel: "Manage billing",
      ctaHref: "/billing",
    };
  }

  if (status === 402 && msg.toLowerCase().includes("canceled")) {
    return {
      tone: "danger",
      title: "Subscription canceled",
      message: "Your subscription is canceled. Upgrade to restore access.",
      ctaLabel: "View plans",
      ctaHref: "/billing",
    };
  }

  if (status === 403 && msg.toLowerCase().includes("feature")) {
    return {
      tone: "warn",
      title: "Not included in your plan",
      message: msg,
      ctaLabel: "See plans",
      ctaHref: "/billing",
    };
  }

  return null;
}

export function disabledReason({ isAdmin, featureEnabled, tenantStatus, label }) {
  const st = String(tenantStatus || "active").toLowerCase();

  if (!isAdmin) return "Owner/Admin only";

  // optional strict enforcement on billing status
  if (st === "past_due") return "Disabled: subscription is past due (update billing).";
  if (st === "canceled") return "Disabled: subscription canceled (upgrade to restore).";

  if (featureEnabled === false) {
    return label ? `Disabled: requires ${label} feature on your plan.` : "Disabled by your plan.";
  }

  return "";
}
