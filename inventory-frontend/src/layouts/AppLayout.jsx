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
    clearPostLoginRedirect();
    setToken("");
    setStoredUser(null);
    setTenantId(null);
    setUser(null);

    try {
      await logoutApi();
    } catch {
      // ignore
    }

    window.location.replace("/");
  }

  return (
    <div className="app-shell">
      <div className="app-topbar">
        <p className="app-topbar-left">
          Logged in as{" "}
          <span className={`app-rolePill ${isAdmin ? "admin" : "staff"}`}>
            {uiRole || "user"}
          </span>
        </p>

        <button className="btn" onClick={logout}>
          Logout
        </button>
      </div>

      <div className="app-body">
        <Sidebar user={user} />
        <main className="app-main">
          <div className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
