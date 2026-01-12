import { Link } from "react-router-dom";

export default function Sidebar() {
  return (
    <div style={{
      width: 220,
      background: "#111827",
      color: "#fff",
      padding: 20
    }}>
      <h2>Inventory</h2>

      <nav style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Link to="/" style={{ color: "#fff", textDecoration: "none" }}>
          Dashboard
        </Link>
        <Link to="/products" style={{ color: "#fff", textDecoration: "none" }}>
          Products
        </Link>
        <Link to="/categories" style={{ color: "#fff", textDecoration: "none" }}>
          Categories
          
        </Link>
        <Link to="/stock" style={{ color: "#fff", textDecoration: "none" }}>
          Stock In / Out
        </Link>
      </nav>
    </div>
  );
}


console.log("API BASE:", import.meta.env.VITE_API_BASE);
