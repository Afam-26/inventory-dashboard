import { useEffect, useState } from "react";
import { getDashboard } from "../services/api";

export default function Dashboard() {
  const [data, setData] = useState({ totalProducts: 0, lowStockCount: 0, inventoryValue: 0 });
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

        <div className="card">
          <h3>Inventory Value</h3>
          <p style={{ fontSize: 24 }}>
            ${Number(data.inventoryValue).toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
}
