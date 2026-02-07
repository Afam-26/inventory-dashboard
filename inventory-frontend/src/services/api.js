
// src/services/api.js

/**
 * ============================
 * API BASE
 * ============================
 */
const API_BASE =
  (import.meta.env.VITE_API_BASE || "http://localhost:5000") + "/api";

/**
 * ============================
 * Safe JSON helper
 * ============================
 */
async function safeJson(res) {
  if (res.status === 204 || res.status === 304) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * ============================
 * Token handling
 * ============================
 */
let authToken = localStorage.getItem("token") || "";

export function setToken(token) {
  authToken = token || "";
  if (authToken) localStorage.setItem("token", authToken);
  else localStorage.removeItem("token");
}

function authHeaders() {
  const t = authToken || localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * ============================
 * JWT helpers (needed by SessionGuard)
 * ============================
 */
function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;

    // Base64url → Base64
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getTokenExpMs() {
  const token = localStorage.getItem("token");
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return null;

  // JWT exp is seconds
  return Number(payload.exp) * 1000;
}

export function getTokenRemainingMs() {
  const expMs = getTokenExpMs();
  if (!expMs) return 0;
  return Math.max(0, expMs - Date.now());
}

export function isTokenExpired(leewayMs = 0) {
  const expMs = getTokenExpMs();
  if (!expMs) return true;
  return Date.now() + Number(leewayMs || 0) >= expMs;
}

/**
 * ============================
 * Tenant handling
 * ============================
 */
export function getTenantId() {
  const v = localStorage.getItem("tenantId");
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setTenantId(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) {
    localStorage.removeItem("tenantId");
    return;
  }
  localStorage.setItem("tenantId", String(n));
}

/**
 * ============================
 * User storage
 * ============================
 */
export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) localStorage.setItem("user", JSON.stringify(user));
  else localStorage.removeItem("user");
}

/**
 * ============================
 * Global auth-expired handling
 * - lets SessionGuard + API fetches force login redirect
 * ============================
 */
const authExpiredListeners = new Set();

export function onAuthExpired(cb) {
  if (typeof cb !== "function") return () => {};
  authExpiredListeners.add(cb);
  return () => authExpiredListeners.delete(cb);
}

export function clearSessionStorage() {
  setToken("");
  setTenantId(null);
  setStoredUser(null);
}

export function handleAuthExpired(reason = "TOKEN_EXPIRED") {
  // clear first
  clearSessionStorage();

  // notify listeners (SessionGuard can show UI or just let redirect happen)
  for (const cb of authExpiredListeners) {
    try {
      cb({ reason });
    } catch {
      // ignore
    }
  }

  // hard redirect so we never stay on broken private routes
  try {
    const path = window.location.pathname || "";
    if (!path.startsWith("/login")) {
      window.location.replace("/login");
    }
  } catch {
    // ignore
  }
}

/**
 * ============================
 * Error helper
 * ============================
 */
function makeApiError(message, code, status) {
  const err = new Error(message || "Request failed");
  if (code) err.code = code;
  if (status) err.status = status;
  return err;
}

/**
 * ============================
 * Base Fetch Helper
 * - useAuth: adds Authorization header
 * - useCookie: includes refresh cookie
 * - useTenantHeader: adds x-tenant-id (when selected)
 * ============================
 */
async function baseFetch(
  url,
  options = {},
  { useAuth = false, useCookie = false, useTenantHeader = true } = {}
) {
  const tenantId = getTenantId();

  const headers = {
    ...(options.headers || {}),
    ...(useAuth ? authHeaders() : {}),
    ...(useTenantHeader && tenantId ? { "x-tenant-id": String(tenantId) } : {}),
  };

  const doFetch = async (u) =>
    fetch(u, {
      ...options,
      headers,
      ...(useCookie ? { credentials: "include" } : {}),
      cache: "no-store",
    });

  let res = await doFetch(url);

  // If 304 happens, force a fresh GET with cache-busting
  if (res.status === 304) {
    const sep = url.includes("?") ? "&" : "?";
    res = await doFetch(`${url}${sep}_ts=${Date.now()}`);
  }

  if (res.status === 204) return {};

  const data = await safeJson(res);

  if (!res.ok) {
    const msg = data?.message || "Request failed";
    const code = data?.code || "API_ERROR";

    // ✅ Tenant-required normalization
    if (String(msg).toLowerCase().includes("tenant") && String(msg).toLowerCase().includes("selected")) {
      try {
        if (!window.location.pathname.startsWith("/select-tenant")) {
          window.location.replace("/select-tenant");
        }
      } catch {
        //empty
      }
      throw makeApiError(msg, "TENANT_REQUIRED", res.status);
    }


    // ✅ Token expired / invalid → force login page (no “invalid token” UI)
    const lower = String(msg).toLowerCase();
    const isAuth401 = res.status === 401;
    const looksExpired =
      code === "TOKEN_EXPIRED" ||
      lower.includes("token expired") ||
      lower.includes("jwt expired") ||
      lower.includes("expired token");

    const looksInvalid =
      code === "INVALID_TOKEN" ||
      lower.includes("invalid token") ||
      lower.includes("jwt malformed") ||
      lower.includes("missing token");

    if (isAuth401 && (looksExpired || looksInvalid)) {
      handleAuthExpired(looksExpired ? "TOKEN_EXPIRED" : "INVALID_TOKEN");
      throw makeApiError(
        "Session expired. Please sign in again.",
        "AUTH_EXPIRED",
        401
      );
    }

    throw makeApiError(msg, code, res.status);
  }

  return data ?? {};
}

/**
 * ============================
 * AUTH
 * ============================
 */
export async function login(email, password) {
  const data = await baseFetch(
    `${API_BASE}/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    { useCookie: true, useTenantHeader: false }
  );

  if (data?.token) setToken(data.token);
  if (data?.user) setStoredUser(data.user);
  return data; // { token, user, tenants }
}

export async function register(payload) {
  const data = await baseFetch(
    `${API_BASE}/auth/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useCookie: true, useTenantHeader: false }
  );

  if (data?.token) setToken(data.token);
  if (data?.user) setStoredUser(data.user);
  return data;
}

export async function refresh() {
  const data = await baseFetch(
    `${API_BASE}/auth/refresh`,
    { method: "POST" },
    { useCookie: true }
  );

  if (data?.token) setToken(data.token);
  if (data?.user) setStoredUser(data.user);
  return data;
}

export async function logoutApi() {
  const data = await baseFetch(
    `${API_BASE}/auth/logout`,
    { method: "POST" },
    { useCookie: true }
  );

  clearSessionStorage();
  return data;
}

export async function requestPasswordReset(email) {
  return baseFetch(
    `${API_BASE}/auth/forgot-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
    { useTenantHeader: false }
  );
}

export async function resetPassword(email, token, newPassword) {
  return baseFetch(
    `${API_BASE}/auth/reset-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token, newPassword }),
    },
    { useTenantHeader: false }
  );
}

/**
 * ============================
 * TENANTS
 * ============================
 */
export async function getMyTenants() {
  return baseFetch(`${API_BASE}/auth/tenants`, {}, { useAuth: true, useTenantHeader: false });
}

export async function selectTenantApi(tenantId) {
  const data = await baseFetch(
    `${API_BASE}/auth/select-tenant`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    },
    { useAuth: true, useTenantHeader: false }
  );

  if (data?.token) setToken(data.token);
  if (data?.tenantId) setTenantId(data.tenantId);

  const u = getStoredUser();
  if (u) setStoredUser({ ...u, tenantRole: data?.role });

  return data; // { token, tenantId, role }
}

export async function inviteUserToTenant(payload) {
  return baseFetch(
    `${API_BASE}/tenants/current/invite`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useAuth: true }
  );
}

/**
 * ============================
 * DASHBOARD
 * ============================
 */
export async function getDashboard() {
  return baseFetch(`${API_BASE}/dashboard`, {}, { useAuth: true });
}

/**
 * ============================
 * CATEGORIES
 * ============================
 */
export async function getCategories() {
  return baseFetch(`${API_BASE}/categories`, {}, { useAuth: true });
}

export async function addCategory(name) {
  return baseFetch(
    `${API_BASE}/categories`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    { useAuth: true }
  );
}

export async function deleteCategory(id) {
  return baseFetch(`${API_BASE}/categories/${id}`, { method: "DELETE" }, { useAuth: true });
}

export async function getDeletedCategories() {
  return baseFetch(`${API_BASE}/categories/deleted`, {}, { useAuth: true });
}

export async function restoreCategory(id) {
  return baseFetch(`${API_BASE}/categories/${id}/restore`, { method: "POST" }, { useAuth: true });
}

/**
 * ============================
 * PRODUCTS (✅ updated for SOFT delete + query flags)
 * ============================
 *
 * getProducts signature now supports:
 *   getProducts("search text")                     // backward compatible
 *   getProducts({ q, includeDeleted, onlyDeleted }) // new preferred
 *
 * Backend expected:
 *  - GET /api/products?q=...&includeDeleted=true
 *  - or GET /api/products?q=...&onlyDeleted=true
 *  - DELETE /api/products/:id          => soft delete (sets deleted_at)
 *  - PATCH /api/products/:id/restore   => restore (sets deleted_at NULL)
 */
export async function getProducts(search = "", opts = {}) {
  const q = String(search || "").trim();

  const includeDeleted = Boolean(opts?.includeDeleted);
  const onlyDeleted = Boolean(opts?.onlyDeleted);

  const qs = new URLSearchParams();
  if (q) qs.set("search", q);
  if (includeDeleted) qs.set("includeDeleted", "true");
  if (onlyDeleted) qs.set("onlyDeleted", "true");

  const url = `${API_BASE}/products${qs.toString() ? `?${qs.toString()}` : ""}`;
  return baseFetch(url, {}, { useAuth: true });
}

export async function addProduct(payload) {
  return baseFetch(
    `${API_BASE}/products`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useAuth: true }
  );
}

export async function updateProduct(id, payload) {
  return baseFetch(
    `${API_BASE}/products/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useAuth: true }
  );
}

// ✅ soft delete (backend sets deleted_at)
export async function deleteProduct(id) {
  return baseFetch(`${API_BASE}/products/${id}`, { method: "DELETE" }, { useAuth: true });
}

// ✅ restore soft-deleted product
export async function restoreProduct(id) {
  return baseFetch(`${API_BASE}/products/${id}/restore`, { method: "PATCH" }, { useAuth: true });
}

// ✅ permanently delete (owner-only backend)
export async function hardDeleteProduct(id) {
  return baseFetch(`${API_BASE}/products/${id}/hard`, { method: "DELETE" }, { useAuth: true });
}

// ✅ Used by Stock.jsx scanner — now matches SKU OR barcode via backend /by-sku route
export async function getProductBySku(skuOrBarcode) {
  const code = String(skuOrBarcode || "").trim();
  if (!code) throw new Error("SKU is required");

  return baseFetch(`${API_BASE}/products/by-sku/${encodeURIComponent(code)}`, {}, { useAuth: true });
}

export async function getProductByCode(code) {
  const clean = String(code || "").trim();
  if (!clean) throw new Error("Code is required");

  return baseFetch(`${API_BASE}/products/by-code/${encodeURIComponent(clean)}`, {}, { useAuth: true });
}

// CSV export
export async function fetchProductsCsvBlob() {
  const res = await fetch(`${API_BASE}/products/export.csv`, {
    headers: {
      ...authHeaders(),
      ...(getTenantId() ? { "x-tenant-id": String(getTenantId()) } : {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "CSV export failed");
  }
  return await res.blob();
}

export async function downloadProductsCsv() {
  const blob = await fetchProductsCsvBlob();
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "products.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export async function importProductsRows(rows, { createMissingCategories = true } = {}) {
  return baseFetch(
    `${API_BASE}/products/import-rows`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, createMissingCategories }),
    },
    { useAuth: true }
  );
}

/**
 * ============================
 * STOCK
 * ============================
 */
export async function updateStock(payload) {
  const body = {
    productId: Number(payload.product_id ?? payload.productId),
    type: String(payload.type || "").toUpperCase(),
    quantity: Number(payload.quantity),
    reason: payload.reason || "",
  };

  return baseFetch(
    `${API_BASE}/stock/move`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { useAuth: true }
  );
}

export async function getMovements(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") qs.set(k, String(v));
  }

  const url = `${API_BASE}/stock/movements${qs.toString() ? `?${qs}` : ""}`;
  const data = await baseFetch(url, {}, { useAuth: true });

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.movements)) return data.movements;
  return [];
}

export async function fetchStockCsvBlob(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") qs.set(k, String(v));
  }

  const res = await fetch(`${API_BASE}/stock/export.csv${qs.toString() ? `?${qs}` : ""}`, {
    headers: {
      ...authHeaders(),
      ...(getTenantId() ? { "x-tenant-id": String(getTenantId()) } : {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Stock CSV export failed");
  }

  return await res.blob();
}

export async function downloadStockCsv(params = {}) {
  const blob = await fetchStockCsvBlob(params);
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "stock_movements.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

/**
 * ============================
 * USERS (Admin screen)
 * ============================
 */
export async function getUsers() {
  const data = await baseFetch(`${API_BASE}/users`, {}, { useAuth: true });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.users)) return data.users;
  return [];
}

export async function createUser(payload) {
  return baseFetch(
    `${API_BASE}/users`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useAuth: true }
  );
}

export async function updateUserRoleById(id, role) {
  return baseFetch(
    `${API_BASE}/users/${id}/role`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    },
    { useAuth: true }
  );
}

export async function removeUserFromTenant(id) {
  return baseFetch(`${API_BASE}/users/${id}`, { method: "DELETE" }, { useAuth: true });
}

/**
 * ============================
 * AUDIT LOGS
 * ============================
 */
export async function getAuditLogs(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") qs.set(k, String(v));
  }

  const data = await baseFetch(
    `${API_BASE}/audit${qs.toString() ? `?${qs}` : ""}`,
    {},
    { useAuth: true }
  );

  return {
    page: Number(data?.page || 1),
    limit: Number(data?.limit || 50),
    total: Number(data?.total || 0),
    logs: Array.isArray(data?.logs) ? data.logs : Array.isArray(data) ? data : [],
  };
}

export async function fetchAuditCsvBlob(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") qs.set(k, String(v));
  }

  const res = await fetch(`${API_BASE}/audit/csv${qs.toString() ? `?${qs}` : ""}`, {
    headers: {
      ...authHeaders(),
      ...(getTenantId() ? { "x-tenant-id": String(getTenantId()) } : {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "CSV export failed");
  }

  return await res.blob();
}

export async function downloadAuditCsv(params = {}) {
  const blob = await fetchAuditCsvBlob(params);
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "audit_logs.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

/**
 * ============================
 * BILLING
 * ============================
 */
export async function getPlans() {
  const data = await baseFetch(`${API_BASE}/billing/plans`, {}, { useAuth: true });

  if (data && typeof data === "object" && Array.isArray(data.plans)) {
    return { plans: data.plans, stripeEnabled: Boolean(data.stripeEnabled) };
  }

  if (Array.isArray(data)) return { plans: data, stripeEnabled: false };
  return { plans: [], stripeEnabled: false };
}

export async function getCurrentPlan() {
  const data = await baseFetch(`${API_BASE}/billing/current`, {}, { useAuth: true });

  return {
    tenantId: data?.tenantId ?? null,
    planKey: data?.planKey ?? "starter",
    planName: data?.planName ?? "Starter",
    priceLabel: data?.priceLabel ?? "",
    tenantStatus: data?.tenantStatus ?? "active",
    stripe: {
      enabled: Boolean(data?.stripe?.enabled),
      customerId: data?.stripe?.customerId ?? null,
      subscriptionId: data?.stripe?.subscriptionId ?? null,
      status: data?.stripe?.status ?? null,
      currentPeriodEnd: data?.stripe?.currentPeriodEnd ?? null,
    },
    usage: data?.usage ?? null,
  };
}

export async function updateCurrentPlan(planKey) {
  return baseFetch(
    `${API_BASE}/billing/change-plan`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planKey }),
    },
    { useAuth: true }
  );
}

/**
 * ============================
 * STRIPE
 * ============================
 */
export async function startStripeCheckout({ planKey }) {
  return baseFetch(
    `${API_BASE}/billing/stripe/checkout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planKey }),
    },
    { useAuth: true }
  );
}


export async function openStripePortal() {
  return baseFetch(`${API_BASE}/billing/stripe/portal`, { method: "POST" }, { useAuth: true });
}

/**
 * ============================
 * SETTINGS
 * ============================
 */
export async function getSettings() {
  return baseFetch(`${API_BASE}/settings`, {}, { useAuth: true });
}

export async function updateLowStockThreshold(value) {
  return baseFetch(
    `${API_BASE}/settings/low-stock-threshold`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
    { useAuth: true }
  );
}

// ✅ reconcile one product
export async function reconcileProductStock(id) {
  return baseFetch(`${API_BASE}/products/${id}/reconcile`, { method: "POST" }, { useAuth: true });
}

// ✅ bulk reconcile
export async function reconcileAllStock(minAbsDrift = 1) {
  return baseFetch(
    `${API_BASE}/stock/reconcile-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minAbsDrift }),
    },
    { useAuth: true }
  );
}

export async function updateStockDriftThreshold(value) {
  return baseFetch(
    `${API_BASE}/settings/stock-drift-threshold`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
    { useAuth: true }
  );
}
