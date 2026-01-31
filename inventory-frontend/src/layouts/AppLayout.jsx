// src/layouts/AppLayout.jsx
import { Outlet } from "react-router-dom";
import { useMemo } from "react";
import Sidebar from "../components/Sidebar";

import { logoutApi, setToken, setStoredUser, setTenantId } from "../services/api";
import { clearPostLoginRedirect } from "../utils/authRedirect";

export default function AppLayout({ user, setUser }) {
  const uiRole = useMemo(
    () => String(user?.tenantRole || user?.role || "").toLowerCase(),
    [user]
  );

  const isAdmin = uiRole === "admin" || uiRole === "owner";

  async function logout() {
    // ✅ always clear local state FIRST (prevents UI flash / stale guard logic)
    clearPostLoginRedirect();
    setToken("");
    setStoredUser(null);
    setTenantId(null);
    setUser(null);

    // best-effort server logout
    try {
      await logoutApi();
    } catch {
      // ignore — local state already cleared
    }

    // ✅ hard reset
    window.location.replace("/");
  }

  return (
    <div>
      {/* Top bar (APP ONLY) */}
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
