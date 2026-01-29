// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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

import { getStoredUser, setToken, setStoredUser, setTenantId } from "./services/api";

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());

  const uiRole = useMemo(
    () => String(user?.tenantRole || user?.role || "").toLowerCase(),
    [user]
  );
  const isAdmin = uiRole === "admin" || uiRole === "owner";

  function logout() {
    // clear everything auth-related
    setToken("");
    setStoredUser(null);
    setTenantId(null);
    setUser(null);
  }

  // ✅ Auth states:
  // - no user => must login
  // - user exists but no tenantId => must select tenant
  const needsLogin = !user;
  const needsTenant = !!user && !user?.tenantId;

  return (
    <BrowserRouter>
      <Routes>
        {/* =========================
            Public routes
           ========================= */}
        <Route
          path="/login"
          element={
            needsLogin ? (
              <Login onSuccess={(u) => setUser(u)} />
            ) : needsTenant ? (
              <Navigate to="/select-tenant" replace />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />

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

        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* =========================
            Protected app
           ========================= */}
        <Route
          path="/*"
          element={
            needsLogin ? (
              <Navigate to="/login" replace />
            ) : needsTenant ? (
              <Navigate to="/select-tenant" replace />
            ) : (
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
                    <Routes>
                      <Route path="/" element={<Dashboard user={user} />} />
                      <Route path="/products" element={<Products user={user} />} />

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

                      {/* Logs page accessible to everyone */}
                      <Route path="/audit" element={<AuditLogs user={user} />} />

                      <Route path="/unauthorized" element={<Unauthorized />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </main>
                </div>
              </div>
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
