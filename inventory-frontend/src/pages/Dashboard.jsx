import { useEffect, useState } from "react";
import { getDashboard } from "../services/api";

export default function Dashboard({ user }) {
  const isAdmin = user?.role === "admin";

  const [data, setData] = useState({
    totalProducts: 0,
    lowStockCount: 0,
    inventoryValue: null,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setError("");
        setLoading(true);
        const d = await getDashboard();
        setData(d);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p>Loading...</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;

  return (
    <div>
      <h1>Dashboard</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <div className="card">
          <h3>Total Products</h3>
          <p style={{ fontSize: 24 }}>{data.totalProducts}</p>
        </div>

        <div className="card">
          <h3>Low Stock Items</h3>
          <p style={{ fontSize: 24 }}>{data.lowStockCount}</p>
        </div>

        {/* ✅ Admin-only card */}
        {isAdmin ? (
          <div className="card">
            <h3>Inventory Value</h3>
            <p style={{ fontSize: 24 }}>
              ${Number(data.inventoryValue || 0).toFixed(2)}
            </p>
          </div>
        ) : (
          <div className="card">
            <h3>Inventory Value</h3>
            <p style={{ fontSize: 14, color: "#6b7280" }}>Admins only</p>
          </div>
        )}
      </div>
    </div>
  );
}
