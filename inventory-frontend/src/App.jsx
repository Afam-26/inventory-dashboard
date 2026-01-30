// src/App.jsx
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useMemo, useState } from "react";

import Sidebar from "./components/Sidebar";
import RequireAdmin from "./components/RequireAdmin";

import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Unauthorized from "./pages/Unauthorized";

import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Categories from "./pages/Categories";
import Stock from "./pages/Stock";
import AuditLogs from "./pages/AuditLogs";
import UsersAdmin from "./pages/UsersAdmin";
import AuditDashboard from "./pages/AuditDashboard";
import SelectTenant from "./pages/SelectTenant";
import Signup from "./pages/Signup";
import Billing from "./pages/Billing";
import Landing from "./pages/Landing";

import {
  getStoredUser,
  setToken,
  setStoredUser,
  setTenantId,
  getTenantId,
  logoutApi,
} from "./services/api";

/**
 * ✅ Proper Router Refactor (single Routes tree)
 * - Public routes: Landing, Login, Signup, Forgot/Reset, SelectTenant
 * - Protected layout: Sidebar + TopBar + Outlet
 * - Protected pages: Dashboard, Products, Categories, Stock, Users, Audit, Billing, etc.
 *
 * Auth logic:
 * - no user => must login
 * - user exists but no tenantId => must select tenant
 */
export default function App() {
  const [user, setUser] = useState(() => getStoredUser());

  const needsLogin = !user;
  const needsTenant = !!user && !getTenantId(); // ✅ use stored tenantId

  return (
    <Routes>
      {/* =========================
          Public routes
         ========================= */}
      <Route path="/" element={<Landing />} />

      <Route
        path="/login"
        element={
          needsLogin ? (
            <Login onSuccess={(u) => setUser(u)} />
          ) : needsTenant ? (
            <Navigate to="/select-tenant" replace />
          ) : (
            <Navigate to="/dashboard" replace />
          )
        }
      />

      <Route
        path="/signup"
        element={
          needsLogin ? (
            <Signup onSuccess={(u) => setUser(u)} />
          ) : needsTenant ? (
            <Navigate to="/select-tenant" replace />
          ) : (
            <Navigate to="/dashboard" replace />
          )
        }
      />

      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route
        path="/select-tenant"
        element={
          needsLogin ? (
            <Navigate to="/login" replace />
          ) : (
            <SelectTenant onSuccess={(u) => setUser(u)} />
          )
        }
      />

      {/* =========================
          Protected routes (layout)
         ========================= */}
      <Route
        element={
          needsLogin ? (
            <Navigate to="/login" replace />
          ) : needsTenant ? (
            <Navigate to="/select-tenant" replace />
          ) : (
            <ProtectedLayout user={user} setUser={setUser} />
          )
        }
      >
        <Route path="/dashboard" element={<Dashboard user={user} />} />
        <Route path="/products" element={<Products user={user} />} />

        {/* Logs page accessible to everyone (once authenticated) */}
        <Route path="/audit" element={<AuditLogs user={user} />} />

        {/* Admin/Owner-only pages */}
        <Route
          path="/categories"
          element={
            <RequireAdmin user={user}>
              <Categories user={user} />
            </RequireAdmin>
          }
        />

        <Route
          path="/audit-dashboard"
          element={
            <RequireAdmin user={user}>
              <AuditDashboard user={user} />
            </RequireAdmin>
          }
        />

        <Route
          path="/stock"
          element={
            <RequireAdmin user={user}>
              <Stock user={user} />
            </RequireAdmin>
          }
        />

        <Route
          path="/users"
          element={
            <RequireAdmin user={user}>
              <UsersAdmin user={user} />
            </RequireAdmin>
          }
        />

        <Route
          path="/billing"
          element={
            <RequireAdmin user={user}>
              <Billing user={user} />
            </RequireAdmin>
          }
        />

        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* Default authenticated route */}
        <Route path="/app" element={<Navigate to="/dashboard" replace />} />

        {/* Catch-all inside protected area */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>

      {/* Global catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Protected layout wrapper:
 * - Top bar with role badge + logout
 * - Sidebar
 * - Outlet where protected pages render
 */
function ProtectedLayout({ user, setUser }) {  

  const uiRole = useMemo(
    () => String(user?.tenantRole || user?.role || "").toLowerCase(),
    [user]
  );
  const isAdmin = uiRole === "admin" || uiRole === "owner";

  async function logout() {
      try {
        await logoutApi(); // ✅ clears refresh cookie + localStorage
      } catch {
        // even if API fails, still clear local state and exit
        setToken("");
        setStoredUser(null);
        setTenantId(null);
      }

      setUser(null);

      // ✅ hard reset guarantees landing renders cleanly
      window.location.replace("/");
    }


  return (
    <div>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: 10,
          alignItems: "center",
        }}
      >
        <p style={{ margin: 0 }}>
          Logged in as{" "}
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: isAdmin ? "#111827" : "#2563eb",
              color: "#fff",
              fontWeight: 600,
              fontSize: 12,
              textTransform: "uppercase",
            }}
          >
            {uiRole || "user"}
          </span>
        </p>

        <button className="btn" onClick={logout}>
          Logout
        </button>
      </div>

      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar user={user} />

        <main style={{ flex: 1, padding: 20 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
