// src/pages/SignIn.jsx
import React, { useState } from "react";
import axios from "axios";
import { Link, useLocation, useNavigate } from "react-router-dom";

/**
 * SignIn page for your project.
 * - Calls POST /api/auth/login
 * - Saves token + user to localStorage
 * - Navigates to /dashboard (or the page the user originally tried to visit)
 * - Supports refresh_token cookie by sending withCredentials: true
 *
 * Usage:
 * 1) Put this file at: src/pages/SignIn.jsx
 * 2) Add a route: <Route path="/signin" element={<SignIn />} />
 */

const API_BASE =
  import.meta?.env?.VITE_API_URL?.trim() || "http://localhost:5000";

export default function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();

  // If your ProtectedRoute redirects to /signin with state, this returns the user back.
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
      const res = await axios.post(
        `${API_BASE}/api/auth/login`,
        { email, password },
        {
          withCredentials: true, // IMPORTANT: sends/receives refresh_token cookie
          headers: { "Content-Type": "application/json" },
        }
      );

      // Your backend response shape (as you posted):
      // { token: "...", user: { id, email, role, full_name } }
      const token = res.data?.token;
      const user = res.data?.user;

      if (!token || !user) {
        console.log("Unexpected login response:", res.data);
        throw new Error("Login succeeded but token/user is missing in response.");
      }

      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));

      // Optional: role-based routing (edit paths if your app differs)
      // const role = user.role;
      // const target =
      //   role === "admin" ? "/dashboard" : role === "staff" ? "/dashboard" : from;

      // Navigate after saving token/user so your ProtectedRoute can see it immediately
      navigate(from, { replace: true });
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Unable to sign in. Please try again.";
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
          <p style={styles.subtitle}>
            Use your admin/staff credentials to access the dashboard.
          </p>
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
                aria-label={showPassword ? "Hide password" : "Show password"}
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

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          <div>
            API Base: <code>{API_BASE}</code>
          </div>
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
  footerRow: {
    display: "flex",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    fontSize: 13,
  },
  link: { color: "#111827", textDecoration: "underline" },
  muted: { color: "rgba(0,0,0,0.6)" },
};
