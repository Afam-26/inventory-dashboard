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
 * ============================
 * - useAuth: adds Authorization
 * - useCookie: sends refresh cookie
 * - useTenantHeader: adds x-tenant-id if tenant is selected
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

  // ✅ If 304 happens, force a fresh GET with cache-busting
  if (res.status === 304) {
    const sep = url.includes("?") ? "&" : "?";
    res = await doFetch(`${url}${sep}_ts=${Date.now()}`);
  }

  if (res.status === 204) return {};

  const data = await safeJson(res);

  if (!res.ok) {
    const msg = data?.message || "Request failed";

    // ✅ Normalize "No tenant selected" into a code
    if (
      String(msg).toLowerCase().includes("tenant") &&
      String(msg).toLowerCase().includes("selected")
    ) {
      throw makeApiError(msg, "TENANT_REQUIRED", res.status);
    }

    throw makeApiError(msg, "API_ERROR", res.status);
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

  // store token + user
  if (data?.token) setToken(data.token);
  if (data?.user) setStoredUser(data.user);

  // IMPORTANT: do NOT setTenantId here (login returns user-token)
  return data; // { token, user, tenants }
}

export async function refresh() {
  const data = await baseFetch(
    `${API_BASE}/auth/refresh`,
    { method: "POST" },
    { useCookie: true } // includes tenant header automatically if tenantId exists
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

  // Clear local state
  setToken("");
  setTenantId(null);
  setStoredUser(null);

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

  // also update stored user role info (optional)
  const u = getStoredUser();
  if (u) setStoredUser({ ...u, tenantRole: data?.role });

  return data; // { token, tenantId, role }
}

export async function createTenantApi(payload) {
  return baseFetch(
    `${API_BASE}/tenants`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useAuth: true, useTenantHeader: false }
  );
}

export async function getCurrentTenantApi() {
  return baseFetch(`${API_BASE}/tenants/current`, {}, { useAuth: true });
}

export async function updateTenantBrandingApi(payload) {
  return baseFetch(
    `${API_BASE}/tenants/current/branding`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useAuth: true }
  );
}

export async function inviteUserApi(payload) {
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

export async function acceptInviteApi(payload) {
  // payload: { email, token, full_name, password }
  return baseFetch(
    `${API_BASE}/invites/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useTenantHeader: false }
  );
}

/**
 * ============================
 * TENANT INVITES (NEW)
 * ============================
 */
export async function inviteUserToTenant(payload) {
  // calls /api/tenants/current/invite
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

export async function acceptInvite(payload) {
  // calls /api/invites/accept (no auth required)
  return baseFetch(
    `${API_BASE}/invites/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useTenantHeader: false, useCookie: false }
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

/**
 * ============================
 * PRODUCTS
 * ============================
 */
export async function getProducts(search = "") {
  const q = String(search || "").trim();
  const url = q
    ? `${API_BASE}/products?search=${encodeURIComponent(q)}`
    : `${API_BASE}/products`;

  const data = await baseFetch(url, {}, { useAuth: true });

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.products)) return data.products;

  return [];
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

export async function deleteProduct(id) {
  return baseFetch(`${API_BASE}/products/${id}`, { method: "DELETE" }, { useAuth: true });
}

export async function getProductBySku(sku) {
  return baseFetch(
    `${API_BASE}/products/by-sku/${encodeURIComponent(String(sku || "").trim())}`,
    {},
    { useAuth: true }
  );
}

export async function fetchProductsCsvBlob() {
  const res = await fetch(`${API_BASE}/products/export.csv`, {
    headers: {
      ...authHeaders(),
      ...(getTenantId() ? { "x-tenant-id": String(getTenantId()) } : {}),
    },
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

export async function importProductsCsvText(csvText) {
  return baseFetch(
    `${API_BASE}/products/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText }),
    },
    { useAuth: true }
  );
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

  const res = await fetch(
    `${API_BASE}/stock/export.csv${qs.toString() ? `?${qs}` : ""}`,
    {
      headers: {
        ...authHeaders(),
        ...(getTenantId() ? { "x-tenant-id": String(getTenantId()) } : {}),
      },
    }
  );

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
 * USERS (Admin)
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
 * AUDIT LOGS (Admin)
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
    logs: Array.isArray(data?.logs) ? data.logs : [],
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

export async function getAuditStats(days = 30) {
  return baseFetch(`${API_BASE}/audit/stats?days=${Number(days)}`, {}, { useAuth: true });
}

export async function getAuditReport(days = 7) {
  return baseFetch(`${API_BASE}/audit/report?days=${Number(days)}`, {}, { useAuth: true });
}

export async function getAuditVerify({ limit = 20000 } = {}) {
  return baseFetch(`${API_BASE}/admin/audit/verify?limit=${Number(limit)}`, {}, { useAuth: true });
}
