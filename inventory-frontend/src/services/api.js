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
  try {
    return await res.json();
  } catch {
    return {};
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
 */
async function baseFetch(
  url,
  options = {},
  { useAuth = false, useCookie = false } = {}
) {
  const headers = {
    ...(options.headers || {}),
    ...(useAuth ? authHeaders() : {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
    ...(useCookie ? { credentials: "include" } : {}),
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
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
    { useCookie: true }
  ); // { token, user }
}

export async function refresh() {
  return baseFetch(`${API_BASE}/auth/refresh`, { method: "POST" }, { useCookie: true });
}

export async function logoutApi() {
  return baseFetch(`${API_BASE}/auth/logout`, { method: "POST" }, { useCookie: true });
}

export async function requestPasswordReset(email) {
  return baseFetch(`${API_BASE}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

/**
 * NOTE: backend expects { email, token, newPassword }
 */
export async function resetPassword(email, token, newPassword) {
  return baseFetch(`${API_BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, token, newPassword }),
  });
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

/**
 * ============================
 * PRODUCTS
 * ============================
 */
export async function getProducts() {
  return baseFetch(`${API_BASE}/products`, {}, { useAuth: true });
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
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useAuth: true }
  );
}

export async function deleteProduct(id) {
  return baseFetch(
    `${API_BASE}/products/${id}`,
    { method: "DELETE" },
    { useAuth: true }
  );
}

/**
 * ============================
 * STOCK
 * ============================
 */
export async function updateStock(payload) {
  return baseFetch(
    `${API_BASE}/stock/update`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useAuth: true }
  );
}

export async function getMovements() {
  return baseFetch(`${API_BASE}/stock/movements`, {}, { useAuth: true });
}

/**
 * ============================
 * USERS (Admin)
 * ============================
 */
export async function getUsers() {
  return baseFetch(`${API_BASE}/users`, {}, { useAuth: true });
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
 * AUDIT LOGS
 * ============================
 */
export async function getAuditLogs(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      qs.set(k, String(v));
    }
  }

  return baseFetch(
    `${API_BASE}/audit${qs.toString() ? `?${qs}` : ""}`,
    {},
    { useAuth: true }
  );
}

/** CSV export → Blob (admin-only endpoint) */
export async function fetchAuditCsvBlob(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      qs.set(k, String(v));
    }
  }

  const res = await fetch(
    `${API_BASE}/audit/export.csv${qs.toString() ? `?${qs}` : ""}`,
    { headers: { ...authHeaders() } }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "CSV export failed");
  }

  return await res.blob();
}

/** Convenience: triggers browser download */
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

/** Charts */
export async function getAuditStats(days = 30) {
  return baseFetch(`${API_BASE}/audit/stats?days=${days}`, {}, { useAuth: true });
}

/** SOC report */
export async function getAuditReport(days = 7) {
  return baseFetch(`${API_BASE}/audit/report?days=${days}`, {}, { useAuth: true });
}
