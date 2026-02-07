// src/services/billing.js

const API_BASE =
  (import.meta.env.VITE_API_BASE || "http://localhost:5000") + "/api";

function authHeaders() {
  const token = localStorage.getItem("token") || "";
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// If your app uses a tenant header, include it here.
// Example: const tenantId = localStorage.getItem("tenantId"); h["x-tenant-id"]=tenantId;
function tenantHeaders() {
  return {};
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function apiFetch(path, { method = "GET", body } = {}) {
  const headers = {
    ...authHeaders(),
    ...tenantHeaders(),
  };

  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await safeJson(res);

  if (!res.ok) {
    const msg = data?.message || data?.error || "Request failed";
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function getBillingPlans() {
  return apiFetch("/billing/plans");
}

export function getBillingCurrent() {
  return apiFetch("/billing/current");
}

export async function startCheckout(planKey) {
  const data = await apiFetch("/billing/stripe/checkout", {
    method: "POST",
    body: { planKey },
  });
  if (!data?.url) throw new Error("Missing checkout url");
  window.location.href = data.url;
}

export async function openBillingPortal() {
  const data = await apiFetch("/billing/stripe/portal", {
    method: "POST",
  });
  if (!data?.url) throw new Error("Missing portal url");
  window.location.href = data.url;
}
