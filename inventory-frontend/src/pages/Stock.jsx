import { useEffect, useState } from "react";
import { getProducts, updateStock, getMovements } from "../services/api";

export default function Stock({ user }) {
  const isAdmin = user?.role === "admin";

  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    product_id: "",
    type: "IN",
    quantity: 1,
    reason: "",
  });

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function loadAll() {
    setLoading(true);
    setError("");

    try {
      const [p, m] = await Promise.all([
        getProducts(),
        getMovements(),
      ]);

      setProducts(p);
      setMovements(m);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!isAdmin) {
      setError("Admins only");
      return;
    }

    try {
      await updateStock({
        product_id: Number(form.product_id),
        type: form.type,
        quantity: Number(form.quantity),
        reason: form.reason,
      });

      setForm({
        product_id: "",
        type: "IN",
        quantity: 1,
        reason: "",
      });

      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1>Stock In / Out</h1>

      {/* ADMIN FORM */}
      {isAdmin && (
        <form
          onSubmit={handleSubmit}
          style={{
            display: "grid",
            gap: 10,
            maxWidth: 600,
            marginBottom: 20,
          }}
        >
          <select
            className="input"
            value={form.product_id}
            onChange={(e) => updateField("product_id", e.target.value)}
          >
            <option value="">Select product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (Stock: {p.quantity ?? 0})
              </option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 10 }}>
            <select
              className="input"
              value={form.type}
              onChange={(e) => updateField("type", e.target.value)}
            >
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>

            <input
              className="input"
              type="number"
              min="1"
              value={form.quantity}
              onChange={(e) =>
                updateField("quantity", Number(e.target.value))
              }
              placeholder="Quantity"
            />
          </div>

          <input
            className="input"
            value={form.reason}
            onChange={(e) => updateField("reason", e.target.value)}
            placeholder="Reason (e.g., Restock, Sale, Damage)"
          />

          <button
            className="btn"
            type="submit"
            disabled={!form.product_id || Number(form.quantity) <= 0}
          >
            Update Stock
          </button>
        </form>
      )}

      {/* STATUS */}
      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {/* MOVEMENTS TABLE */}
      <h2>Recent Movements</h2>

      <table
        border="1"
        cellPadding="10"
        style={{ width: "100%", borderCollapse: "collapse" }}
      >
        <thead style={{ background: "#f3f4f6" }}>
          <tr>
            <th>Product</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Reason</th>
            <th>Date</th>
          </tr>
        </thead>

        <tbody>
          {movements.map((m) => (
            <tr key={m.id}>
              <td>{m.product_name}</td>
              <td>{m.type}</td>
              <td>{m.quantity}</td>
              <td>{m.reason || "-"}</td>
              <td>{new Date(m.created_at).toLocaleString()}</td>
            </tr>
          ))}

          {!loading && movements.length === 0 && (
            <tr>
              <td colSpan="5" style={{ textAlign: "center" }}>
                No movements yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
