import React, { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";

import {
  login,
  getMyTenants,
  selectTenantApi,
  setTenantId,
  setToken,
  setStoredUser,
} from "../services/api";

export default function Login({ onSuccess }) {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "/";

  const [email, setEmail] = useState("admin@store.com");
  const [password, setPassword] = useState("admin123");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function resolveTenantsFromLogin(res) {
    if (Array.isArray(res?.tenants)) return res.tenants;

    const t = await getMyTenants();
    return Array.isArray(t?.tenants) ? t.tenants : [];
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // 1) login user-token (tenantId null)
      const res = await login(email, password);

      if (!res?.token || !res?.user) {
        console.log("Unexpected login response:", res);
        throw new Error("Login succeeded but token/user missing.");
      }

      // store user-token first (needed for /auth/tenants or /select-tenant)
      setToken(res.token);
      setStoredUser(res.user);

      // 2) tenants
      const tenants = await resolveTenantsFromLogin(res);
      if (!tenants.length) throw new Error("No tenants found for this user.");

      // 3) pick a tenant (auto first)
      const chosen = tenants[0];
      const sel = await selectTenantApi(chosen.id);

      if (!sel?.token || !sel?.tenantId) {
        console.log("Unexpected select-tenant response:", sel);
        throw new Error("Tenant selection failed (missing token/tenantId).");
      }

      // ✅ store tenant scoped auth
      setToken(sel.token);
      setTenantId(sel.tenantId);

      // ✅ build app user object (tenant aware)
      const u = {
        ...res.user,
        tenantId: sel.tenantId,
        tenantRole: sel.role, // owner/admin/staff
      };

      setStoredUser(u);
      onSuccess?.(u);

      // Debug (optional)
      console.log("selectTenant response:", sel);
      console.log("stored tenantId:", localStorage.getItem("tenantId"));
      console.log(
        "decoded token tenantId:",
        JSON.parse(atob(sel.token.split(".")[1])).tenantId
      );

      navigate(from, { replace: true });
    } catch (err) {
      const msg = err?.message || "Unable to sign in. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Login</h1>
        <p style={styles.subtitle}>Sign in, then auto-select your tenant.</p>

        {error ? (
          <div style={styles.errorBox} role="alert">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <label style={styles.label}>
            Email
            <input
              style={styles.input}
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label style={styles.label}>
            Password
            <div style={styles.passwordRow}>
              <input
                style={{ ...styles.input, margin: 0 }}
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                style={styles.ghostBtn}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <button style={styles.primaryBtn} disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 14, textAlign: "center" }}>
          <Link to="/forgot-password" style={styles.link}>
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 18,
    background:
      "radial-gradient(1200px 600px at 20% 0%, rgba(0,0,0,0.08), transparent), #f7f7fb",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
  },
  card: {
    width: "min(460px, 100%)",
    background: "#fff",
    borderRadius: 16,
    padding: 22,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
    border: "1px solid rgba(0,0,0,0.06)",
  },
  title: { margin: 0, fontSize: 24, letterSpacing: -0.2 },
  subtitle: { margin: "6px 0 0", color: "rgba(0,0,0,0.6)", fontSize: 14 },
  label: {
    display: "grid",
    gap: 6,
    fontSize: 13,
    color: "rgba(0,0,0,0.75)",
  },
  input: {
    height: 42,
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.14)",
    padding: "0 12px",
    outline: "none",
    fontSize: 14,
  },
  passwordRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 8,
    alignItems: "center",
  },
  ghostBtn: {
    height: 42,
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.14)",
    background: "transparent",
    padding: "0 12px",
    cursor: "pointer",
    fontSize: 13,
  },
  primaryBtn: {
    height: 44,
    borderRadius: 12,
    border: "none",
    background: "#111827",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    marginTop: 6,
  },
  errorBox: {
    background: "rgba(220, 38, 38, 0.08)",
    border: "1px solid rgba(220, 38, 38, 0.25)",
    color: "rgba(127, 29, 29, 0.95)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    fontSize: 13,
  },
  link: { color: "#111827", textDecoration: "underline", fontSize: 13 },
};
