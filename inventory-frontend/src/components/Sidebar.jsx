import { Link } from "react-router-dom";

export default function Sidebar({ user }) {
  const isAdmin = user?.role === "admin";
  const linkStyle = { color: "#fff", textDecoration: "none" };

  return (
    <div style={{ width: 220, background: "#111827", color: "#fff", padding: 20 }}>
      <h2>Inventory</h2>

      <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Link to="/" style={linkStyle}>Dashboard</Link>
       


        {/* ✅ Staff can view */}
        <Link to="/products" style={linkStyle}>Products</Link>

        {/* ✅ Admin only */}
        {isAdmin && (
          <>
            <Link to="/categories" style={linkStyle}>Categories</Link>
            <Link to="/stock" style={linkStyle}>Stock In / Out</Link>
            <Link to="/users" style={linkStyle}>Users</Link>

          </>
        )}
         <Link to="/audit" style={linkStyle}>
          {isAdmin ? "Audit Logs" : "My Activity"}
        </Link>
      </nav>
    </div>
  );
}
