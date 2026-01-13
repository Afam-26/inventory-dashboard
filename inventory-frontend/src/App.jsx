import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import { useState } from "react";
import Login from "./pages/Login";
import { getStoredUser, setToken, setStoredUser, logout as apiLogout } from "./services/api";
import RequireAdmin from "./components/RequireAdmin";

import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Categories from "./pages/Categories";
import Stock from "./pages/Stock";

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());

  async function logout() {
  try {
    await apiLogout(); // 🔐 tells backend to revoke refresh token
  } catch {
    // ignore network errors
  } finally {
    setToken("");
    setStoredUser(null);
    setUser(null);
    }
  }


  // ✅ Auth Gate
  if (!user) {
    return <Login onSuccess={(u) => setUser(u)} />;
  }

  return (
    <BrowserRouter>
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
                <Route path="/" element={<Dashboard />} />
                <Route path="/products" element={<Products user={user} />} />
                <Route path="/categories" element={<Categories user={user} />} />
                <Route path="/stock" element={<Stock user={user} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
          </main>
        </div>  
      </div>
    </BrowserRouter>
  );
}
