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
 * Base Fetch Helpers
 * ============================
 * - useCookie=true => credentials: "include"
 * - useAuth=true   => add Authorization header
 */
async function baseFetch(url, options = {}, { useCookie = false, useAuth = false } = {}) {
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
 * These are the ones that should include cookies.
 */

/** POST /api/auth/login (sets refresh_token cookie) */
export async function login(email, password) {
  return baseFetch(
    `${API_BASE}/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    { useCookie: true, useAuth: false }
  ); // returns { token, user }
}

/** POST /api/auth/refresh (uses refresh_token cookie) */
export async function refresh() {
  return baseFetch(
    `${API_BASE}/auth/refresh`,
    { method: "POST" },
    { useCookie: true, useAuth: false }
  ); // returns { token, user }
}

/** POST /api/auth/logout (revokes refresh token + clears cookie) */
export async function logoutApi() {
  return baseFetch(
    `${API_BASE}/auth/logout`,
    { method: "POST" },
    { useCookie: true, useAuth: false }
  ); // returns { message }
}

/**
 * Forgot password
 */
export async function requestPasswordReset(email) {
  return baseFetch(
    `${API_BASE}/auth/forgot-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
    { useCookie: false, useAuth: false }
  );
}

/**
 * Reset password
 * NOTE: Your backend expects: { email, token, newPassword }
 */
export async function resetPassword(email, token, newPassword) {
  return baseFetch(
    `${API_BASE}/auth/reset-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token, newPassword }),
    },
    { useCookie: false, useAuth: false }
  );
}

/**
 * ============================
 * CATEGORIES
 * ============================
 */
export async function getCategories() {
  return baseFetch(
    `${API_BASE}/categories`,
    { headers: {} },
    { useCookie: false, useAuth: true }
  );
}

export async function addCategory(name) {
  return baseFetch(
    `${API_BASE}/categories`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    { useCookie: false, useAuth: true }
  );
}

/**
 * ============================
 * PRODUCTS
 * ============================
 */
export async function getProducts() {
  return baseFetch(
    `${API_BASE}/products`,
    { headers: {} },
    { useCookie: false, useAuth: true }
  );
}

export async function addProduct(payload) {
  return baseFetch(
    `${API_BASE}/products`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { useCookie: false, useAuth: true }
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
    { useCookie: false, useAuth: true }
  );
}

export async function getMovements() {
  return baseFetch(
    `${API_BASE}/stock/movements`,
    { headers: {} },
    { useCookie: false, useAuth: true }
  );
}

/**
 * ============================
 * DASHBOARD
 * ============================
 */
export async function getDashboard() {
  return baseFetch(
    `${API_BASE}/dashboard`,
    { headers: {} },
    { useCookie: false, useAuth: true }
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

  const url = `${API_BASE}/audit${qs.toString() ? `?${qs.toString()}` : ""}`;

  return baseFetch(url, { headers: {} }, { useCookie: false, useAuth: true });
}

/**
 * ============================
 * USERS (Admin)
 * ============================
 */
export async function getUsers() {
  return baseFetch(`${API_BASE}/users`, { headers: {} }, { useAuth: true });
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
 * PRODUCTS (Admin edit/delete)
 * ============================
 */
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

