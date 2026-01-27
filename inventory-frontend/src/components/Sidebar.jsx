// src/components/Sidebar.jsx
import { Link } from "react-router-dom";

export default function Sidebar({ user }) {
  /**
   * IMPORTANT:
   * - Use tenantRole (owner/admin) instead of global role
   */
  const role = String(user?.tenantRole || "").toLowerCase();
  const isAdmin = role === "owner" || role === "admin";

  const linkStyle = {
    color: "#fff",
    textDecoration: "none",
    fontSize: 14,
  };

  return (
    <div
      style={{
        width: 220,
        background: "#111827",
        color: "#fff",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 20 }}>Inventory</h2>

      {/* 🔹 Navigation */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Link to="/" style={linkStyle}>
          Dashboard
        </Link>

        {/* ✅ All logged-in users */}
        <Link to="/products" style={linkStyle}>
          Products
        </Link>

        {/* ✅ Tenant Admin / Owner only */}
        {isAdmin && (
          <>
            <Link to="/categories" style={linkStyle}>
              Categories
            </Link>
            <Link to="/stock" style={linkStyle}>
              Stock In / Out
            </Link>
            <Link to="/users" style={linkStyle}>
              Users
            </Link>
            <Link to="/audit-dashboard" style={linkStyle}>
              Audit Dashboard
            </Link>
          </>
        )}

        {/* ✅ Everyone sees audit (scoped by backend) */}
        <Link to="/audit" style={linkStyle}>
          {isAdmin ? "Audit Logs" : "My Activity"}
        </Link>
      </nav>
    </div>
  );
}
