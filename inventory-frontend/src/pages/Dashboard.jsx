// src/pages/Dashboard.jsx
import { useEffect, useState } from "react";
import { getDashboard } from "../services/api";

export default function Dashboard({ user }) {
  const role = String(user?.tenantRole || user?.role || "staff").toLowerCase();
  const isOwner = role === "owner";

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
        setData(d || {});
      } catch (e) {
        setError(e?.message || "Failed to load dashboard");
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
          <p style={{ fontSize: 24 }}>{Number(data.totalProducts || 0)}</p>
        </div>

        <div className="card">
          <h3>Low Stock Items</h3>
          <p style={{ fontSize: 24 }}>{Number(data.lowStockCount || 0)}</p>
        </div>

        {/* ✅ Owner-only (Admin + Staff see same message) */}
        {isOwner ? (
          <div className="card">
            <h3>Inventory Value</h3>
            <p style={{ fontSize: 24 }}>
              ${Number(data.inventoryValue || 0).toFixed(2)}
            </p>
          </div>
        ) : (
          <div className="card">
            <h3>Inventory Value</h3>
            <p style={{ fontSize: 14, color: "#6b7280" }}>Restricted view</p>
          </div>
        )}
      </div>
    </div>
  );
}
