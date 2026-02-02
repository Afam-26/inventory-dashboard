// src/components/Sidebar.jsx
import { Link, useLocation } from "react-router-dom";

export default function Sidebar({ user }) {
  const uiRole = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isAdmin = uiRole === "admin" || uiRole === "owner";

  const { pathname } = useLocation();
  const isActive = (to) => pathname === to;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Inventory</div>

      <nav className="sidebar-nav">
        <Link className={`sidebar-link ${isActive("/dashboard") ? "active" : ""}`} to="/dashboard">
          Dashboard
        </Link>

        <Link className={`sidebar-link ${isActive("/products") ? "active" : ""}`} to="/products">
          Products
        </Link>

        {isAdmin && (
          <>
            <Link className={`sidebar-link ${isActive("/categories") ? "active" : ""}`} to="/categories">
              Categories
            </Link>
            <Link className={`sidebar-link ${isActive("/stock") ? "active" : ""}`} to="/stock">
              Stock In / Out
            </Link>
            <Link className={`sidebar-link ${isActive("/users") ? "active" : ""}`} to="/users">
              Users
            </Link>
            <Link
              className={`sidebar-link ${isActive("/audit-dashboard") ? "active" : ""}`}
              to="/audit-dashboard"
            >
              Audit Dashboard
            </Link>
            <Link className={`sidebar-link ${isActive("/billing") ? "active" : ""}`} to="/billing">
              Billing
            </Link>
          </>
        )}

        <Link className={`sidebar-link ${isActive("/audit") ? "active" : ""}`} to="/audit">
          {isAdmin ? "Audit Logs" : "My Activity"}
        </Link>
      </nav>
    </aside>
  );
}
