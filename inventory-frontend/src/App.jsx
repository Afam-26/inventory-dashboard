// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useState } from "react";

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

import { getStoredUser, setToken, setStoredUser, setTenantId } from "./services/api";

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());

  function logout() {
    setToken("");
    setTenantId(null); // ✅ clear tenant selection too
    setStoredUser(null);
    setUser(null);
  }

  // ✅ Prefer tenantRole for UI + access control; fallback to global role
  const effectiveRole = String(user?.tenantRole || user?.role || "").toLowerCase();
  const roleLabel =
    effectiveRole === "owner"
      ? "Owner"
      : effectiveRole === "admin"
      ? "Admin"
      : effectiveRole === "staff"
      ? "Staff"
      : "User";

  const roleColor =
    effectiveRole === "owner" || effectiveRole === "admin"
      ? "#111827"
      : effectiveRole === "staff"
      ? "#2563eb"
      : "#6b7280";

  return (
    <BrowserRouter>
      <Routes>
        {/* ✅ Public routes */}
        <Route path="/login" element={<Login onSuccess={(u) => setUser(u)} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* ✅ Protected app (requires login) */}
        <Route
          path="/*"
          element={
            user ? (
              <div>
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
                        background: roleColor,
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 12,
                      }}
                    >
                      {roleLabel}
                    </span>

                    {/* ✅ show tenant info if present */}
                    {user?.tenantId ? (
                      <span
                        style={{
                          marginLeft: 10,
                          padding: "4px 10px",
                          borderRadius: 999,
                          background: "rgba(17,24,39,0.08)",
                          color: "#111827",
                          fontWeight: 600,
                          fontSize: 12,
                          border: "1px solid rgba(17,24,39,0.15)",
                        }}
                        title="Selected tenant"
                      >
                        Tenant #{user.tenantId}
                      </span>
                    ) : null}
                  </p>

                  <button className="btn" onClick={logout}>
                    Logout
                  </button>
                </div>

                <div style={{ display: "flex", minHeight: "100vh" }}>
                  {/* ✅ Pass user to Sidebar */}
                  <Sidebar user={user} />

                  <main style={{ flex: 1, padding: 20 }}>
                    <Routes>
                      <Route path="/" element={<Dashboard user={user} />} />

                      {/* ✅ Products: anyone logged in can view (read-only for staff handled inside Products page) */}
                      <Route path="/products" element={<Products user={user} />} />

                      {/* ✅ Admin-only */}
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

                      {/* ✅ Unauthorized page */}
                      <Route path="/unauthorized" element={<Unauthorized />} />
                      <Route path="/audit" element={<AuditLogs user={user} />} />

                      <Route
                        path="/users"
                        element={
                          <RequireAdmin user={user}>
                            <UsersAdmin user={user} />
                          </RequireAdmin>
                        }
                      />

                      {/* fallback */}
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </main>
                </div>
              </div>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
