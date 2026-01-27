// src/pages/SignIn.jsx
import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  login,
  setToken,
  setStoredUser,
  getMyTenants,
  selectTenantApi,
  setTenantId,
  getTenantId,
} from "../services/api";

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

export default function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Clear any stale tenant
      setTenantId(null);

      // 1) Login (user-token)
      const res = await login(email, password);
      if (!res?.token || !res?.user) {
        console.log("Unexpected login response:", res);
        throw new Error("Login succeeded but token/user missing.");
      }

      setToken(res.token);
      setStoredUser(res.user);

      console.log("LOGIN payload:", decodeJwtPayload(res.token)); // tenantId null is OK here

      // 2) Get tenants (prefer login response, else call /auth/tenants)
      let tenants = Array.isArray(res.tenants) ? res.tenants : null;
      if (!tenants) {
        const t = await getMyTenants(); // <-- THIS must show in Network
        tenants = Array.isArray(t?.tenants) ? t.tenants : [];
      }

      console.log("TENANTS:", tenants);

      if (!tenants.length) {
        throw new Error("No tenants found for this user (tenant_members is empty or status not active).");
      }

      // 3) Choose tenant (reuse stored if exists and user belongs)
      const saved = getTenantId();
      const chosen = saved
        ? tenants.find((x) => Number(x.id) === Number(saved)) || tenants[0]
        : tenants[0];

      // 4) Select tenant (tenant-token)
      const sel = await selectTenantApi(chosen.id); // <-- THIS must show in Network
      console.log("SELECT TENANT response:", sel);

      if (!sel?.token || !sel?.tenantId) {
        throw new Error("Tenant selection succeeded but token/tenantId missing.");
      }

      setToken(sel.token);
      setTenantId(sel.tenantId);

      console.log("AFTER SELECT payload:", decodeJwtPayload(sel.token));
      console.log("tenantId saved:", localStorage.getItem("tenantId"));

      // 5) Go
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err?.message || "Unable to sign in.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={styles.title}>Sign in</h1>
          <p style={styles.subtitle}>We’ll auto-select your tenant after login.</p>
        </div>

        {error ? (
          <div style={styles.errorBox} role="alert">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleLogin} style={{ display: "grid", gap: 12 }}>
          <label style={styles.label}>
            Email
            <input
              style={styles.input}
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@store.com"
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
                placeholder="••••••••"
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

          <button type="submit" style={styles.primaryBtn} disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={styles.footerRow}>
          <span style={styles.muted}>Need help?</span>
          <Link to="/contact" style={styles.link}>
            Contact support
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
  label: { display: "grid", gap: 6, fontSize: 13, color: "rgba(0,0,0,0.75)" },
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
  footerRow: { display: "flex", justifyContent: "center", gap: 8, marginTop: 16, fontSize: 13 },
  link: { color: "#111827", textDecoration: "underline" },
  muted: { color: "rgba(0,0,0,0.6)" },
};
