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
 * AUTH
 * ============================
 */
export async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Login failed");
  return data; // { token, user }
}

/**
 * Forgot password
 */
export async function requestPasswordReset(email) {
  const res = await fetch(`${API_BASE}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
}

/**
 * Reset password
 */
export async function resetPassword(token, password) {
  const res = await fetch(`${API_BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Reset failed");
  return data;
}

/**
 * ============================
 * CATEGORIES
 * ============================
 */
export async function getCategories() {
  const res = await fetch(`${API_BASE}/categories`, {
    headers: { ...authHeaders() },
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to load categories");
  return data;
}

export async function addCategory(name) {
  const res = await fetch(`${API_BASE}/categories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ name }),
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to add category");
  return data;
}

/**
 * ============================
 * PRODUCTS
 * ============================
 */
export async function getProducts() {
  const res = await fetch(`${API_BASE}/products`, {
    headers: { ...authHeaders() },
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to load products");
  return data;
}

export async function addProduct(payload) {
  const res = await fetch(`${API_BASE}/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to add product");
  return data;
}

/**
 * ============================
 * STOCK
 * ============================
 */
export async function updateStock(payload) {
  const res = await fetch(`${API_BASE}/stock/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Stock update failed");
  return data;
}

export async function getMovements() {
  const res = await fetch(`${API_BASE}/stock/movements`, {
    headers: { ...authHeaders() },
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to load movements");
  return data;
}

/**
 * ============================
 * DASHBOARD
 * ============================
 */
export async function getDashboard() {
  const res = await fetch(`${API_BASE}/dashboard`, {
    headers: { ...authHeaders() },
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.message || "Failed to load dashboard");
  return data;
}
