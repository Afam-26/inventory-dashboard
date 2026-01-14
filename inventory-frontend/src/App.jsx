import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import { useState } from "react";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

import { getStoredUser, setToken, setStoredUser } from "./services/api";
import RequireAdmin from "./components/RequireAdmin";

import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Categories from "./pages/Categories";
import Stock from "./pages/Stock";


export default function App() {
  const [user, setUser] = useState(() => getStoredUser());

  function logout() {
    setToken("");
    setStoredUser(null);
    setUser(null);
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* ✅ Public routes (no login required) */}
        <Route path="/login" element={<Login onSuccess={(u) => setUser(u)} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* ✅ Protected app (login required) */}
        <Route
          path="/*"
          element={
            user ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: 10 }}>
                  <p>
                    Logged in as <b>{user.email}</b> ({user.role})
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

                      <Route
                        path="/products"
                        element={
                          <RequireAdmin user={user}>
                            <Products user={user} />
                          </RequireAdmin>
                        }
                      />

                      <Route
                        path="/categories"
                        element={
                          <RequireAdmin user={user}>
                            <Categories user={user} />
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
                      
                      {/* fallback */}
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </main>
                </div>
              </div>
            ) : (
              // If not logged in, go to login
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
