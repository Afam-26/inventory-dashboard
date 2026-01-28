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
  // 204/304 usually have no body
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
 * Tenant handling (NEW)
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
 * Base Fetch Helper
 * ============================
 * - useAuth: adds Authorization
 * - useCookie: sends refresh cookie
 * - useTenantHeader: adds x-tenant-id if tenant is selected (multi-tenant)
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

  // ✅ If 304 happens, force a fresh GET with a cache-busting query param
  if (res.status === 304) {
    const sep = url.includes("?") ? "&" : "?";
    res = await doFetch(`${url}${sep}_ts=${Date.now()}`);
  }

  // Some 204 responses also have no body
  if (res.status === 204) return {};

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.message || "Request failed");
  return data ?? {};
}


/**
 * ============================
 * AUTH
 * ============================
 */
export async function login(email, password) {
  return baseFetch(
    `${API_BASE}/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    { useCookie: true, useTenantHeader: false }
  ); // { token, user, tenants? }
}

/**
 * Refresh token (cookie-based).
 * If you have tenantId saved, baseFetch automatically passes x-tenant-id
 * so refresh can return tenant-scoped token.
 */
export async function refresh() {
  return baseFetch(
    `${API_BASE}/auth/refresh`,
    { method: "POST" },
    { useCookie: true }
  );
}

export async function logoutApi() {
  return baseFetch(
    `${API_BASE}/auth/logout`,
    { method: "POST" },
    { useCookie: true }
  );
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
 * TENANTS (NEW)
 * ============================
 */
export async function getMyTenants() {
  return baseFetch(`${API_BASE}/auth/tenants`, {}, { useAuth: true, useTenantHeader: false }); // { tenants: [] }
}

export async function selectTenantApi(tenantId) {
  return baseFetch(
    `${API_BASE}/auth/select-tenant`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    },
    { useAuth: true, useTenantHeader: false }
  ); // { token, tenantId, role }
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

  // ✅ normalize common shapes
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
  // keep PUT (your note)
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
    headers: { ...authHeaders(), ...(getTenantId() ? { "x-tenant-id": String(getTenantId()) } : {}) },
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
  // backend: /api/stock/move expects productId
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

  // ✅ normalize
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
    { headers: { ...authHeaders(), ...(getTenantId() ? { "x-tenant-id": String(getTenantId()) } : {}) } }
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

  // ✅ normalize
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

  // ✅ normalize (this one returns an object for pagination)
  return {
    page: Number(data?.page || 1),
    limit: Number(data?.limit || 50),
    total: Number(data?.total || 0),
    logs: Array.isArray(data?.logs) ? data.logs : [],
  };
}

/**
 * ✅ Fix audit CSV endpoint (backend is /audit/csv)
 */
export async function fetchAuditCsvBlob(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") qs.set(k, String(v));
  }

  const res = await fetch(
    `${API_BASE}/audit/csv${qs.toString() ? `?${qs}` : ""}`,
    { headers: { ...authHeaders(), ...(getTenantId() ? { "x-tenant-id": String(getTenantId()) } : {}) } }
  );

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
