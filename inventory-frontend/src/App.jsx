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

import { getStoredUser, setToken, setStoredUser } from "./services/api";

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());

  function logout() {
    setToken("");
    setStoredUser(null);
    setUser(null);
  }

  // ✅ Use tenantRole for UI authorization/labeling
  const uiRole = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isAdmin = uiRole === "admin" || uiRole === "owner";

  return (
    <BrowserRouter>
      <Routes>
        {/* ✅ Public routes */}
        <Route path="/login" element={<Login onSuccess={(u) => setUser(u)} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* ✅ Protected app */}
        <Route
          path="/*"
          element={
            user ? (
              <div>
                {/* top bar */}
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

                      {/* ✅ Admin/Owner-only pages */}
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

                      {/* Logs page accessible to everyone (admin sees all, staff sees own) */}
                      <Route path="/audit" element={<AuditLogs user={user} />} />

                      <Route path="/unauthorized" element={<Unauthorized />} />
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
