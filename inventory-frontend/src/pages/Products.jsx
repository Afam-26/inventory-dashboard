import { useEffect, useState } from "react";
import { getProducts, addProduct, getCategories } from "../services/api";



export default function Products({user}) {
  const isAdmin = user?.role === "admin";
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    name: "",
    sku: "",
    category_id: "",
    quantity: 0,
    cost_price: 0,
    selling_price: 0,
    reorder_level: 10,
  });

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [p, c] = await Promise.all([getProducts(), getCategories()]);
      setProducts(p);
      setCategories(c);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await addProduct({
        ...form,
        category_id: form.category_id ? Number(form.category_id) : null,
      });
      setForm({
        name: "",
        sku: "",
        category_id: "",
        quantity: 0,
        cost_price: 0,
        selling_price: 0,
        reorder_level: 10,
      });
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1>Products</h1>

      {isAdmin && (
  <form
    onSubmit={handleSubmit}
    style={{ display: "grid", gap: 10, maxWidth: 600, marginBottom: 20 }}
  >
    <div style={{ display: "flex", gap: 10 }}>
      <input
        className="input"
        placeholder="Product name"
        value={form.name}
        onChange={(e) => updateField("name", e.target.value)}
      />

      <input
        className="input"
        placeholder="SKU"
        value={form.sku}
        onChange={(e) => updateField("sku", e.target.value)}
      />
    </div>

    <div style={{ display: "flex", gap: 10 }}>
      <select
        className="input"
        value={form.category_id}
        onChange={(e) => updateField("category_id", e.target.value)}
      >
        <option value="">Select category</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <input
        className="input"
        type="number"
        placeholder="Quantity"
        value={form.quantity}
        onChange={(e) => updateField("quantity", e.target.value)}
      />
    </div>

    <div style={{ display: "flex", gap: 10 }}>
      <input
        className="input"
        type="number"
        placeholder="Cost price"
        value={form.cost_price}
        onChange={(e) => updateField("cost_price", e.target.value)}
      />

      <input
        className="input"
        type="number"
        placeholder="Selling price"
        value={form.selling_price}
        onChange={(e) => updateField("selling_price", e.target.value)}
      />

      <input
        className="input"
        type="number"
        placeholder="Reorder level"
        value={form.reorder_level}
        onChange={(e) => updateField("reorder_level", e.target.value)}
      />
    </div>

    <button className="btn" type="submit">
      Add Product
    </button>
  </form>
)}


      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}   


      <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ background: "#f3f4f6" }}>
          <tr>
            <th>Name</th>
            <th>SKU</th>
            <th>Category</th>
            <th>Stock</th>
            <th>Cost</th>
            <th>Selling</th>
            <th>Reorder</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.sku}</td>
              <td>{p.category_name || "-"}</td>
              <td>{p.quantity}</td>
              <td>{p.cost_price}</td>
              <td>{p.selling_price}</td>
              <td>{p.reorder_level}</td>
            </tr>
          ))}
          {!loading && products.length === 0 && (
            <tr><td colSpan="7" style={{ textAlign: "center" }}>No products yet</td></tr>
          )}
        </tbody>
      </table>      
    </div>
  );
}
