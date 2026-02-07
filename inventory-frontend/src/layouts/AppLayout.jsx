// src/layouts/AppLayout.jsx
import { Outlet, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import Sidebar from "../components/Sidebar";
import SessionGuard from "../components/SessionGuard";

import { logoutApi, setToken, setStoredUser, setTenantId } from "../services/api";
import { clearPostLoginRedirect } from "../utils/authRedirect";

export default function AppLayout({ user, setUser }) {
  const navigate = useNavigate();
  const uiRole = useMemo(() => {
    const r = String(user?.tenantRole || user?.role || "").toLowerCase().trim();
    return r || "staff";
  }, [user]);

  const isOwner = uiRole === "owner";
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

    navigate("/login", { replace: true });
  }

  const pillStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    marginLeft: 8,
    border: "1px solid #e5e7eb",
    background: "#111827",
    color: "#ffffff",
  };

  return (
    <div className="app-shell">
      {/* ✅ Session features */}
      <SessionGuard enabled={true}/>

      <div className="app-topbar">
        <p className="app-topbar-left">
          Logged in as
          <span className={`app-rolePill ${isOwner ? "owner" : isAdmin ? "admin" : "staff"}`} style={pillStyle}>
            {uiRole}
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
