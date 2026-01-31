// src/utils/authRedirect.js
const KEY = "postLoginRedirect";

function isPublicRoute(p) {
  return (
    p === "/" ||
    p.startsWith("/login") ||
    p.startsWith("/signup") ||
    p.startsWith("/forgot-password") ||
    p.startsWith("/reset-password") ||
    p.startsWith("/select-tenant")
  );
}

/**
 * Save a path to return to after login.
 * - skips public routes
 * - skips invalid values
 */
export function savePostLoginRedirect(path) {
  const p = String(path || "").trim();
  if (!p) return;
  if (!p.startsWith("/")) return;
  if (isPublicRoute(p)) return;

  try {
    localStorage.setItem(KEY, p);
  } catch {
    // ignore storage errors
  }
}

/**
 * Read without deleting. Always returns a safe fallback if not present.
 */
export function peekPostLoginRedirect(fallback = "/dashboard") {
  try {
    const v = localStorage.getItem(KEY);
    const p = String(v || "").trim();
    if (!p) return fallback;
    if (!p.startsWith("/")) return fallback;
    if (isPublicRoute(p)) return fallback;
    return p;
  } catch {
    return fallback;
  }
}

/**
 * Read once and remove.
 */
export function consumePostLoginRedirect(fallback = "/dashboard") {
  const v = peekPostLoginRedirect(fallback);
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
  return v;
}

/**
 * Explicitly clear redirect (use this on logout).
 */
export function clearPostLoginRedirect() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore storage errors
  }
}
