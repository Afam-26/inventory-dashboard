import { useEffect, useState } from "react";
import { getCategories, addCategory, deleteCategory } from "../services/api";

export default function Categories({ user }) {
  const isAdmin = user?.role === "admin";
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadCategories() {
    setLoading(true);
    setError("");
    try {
      const data = await getCategories();
      setCategories(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      await addCategory(name);
      setName("");
      await loadCategories();
    } catch (err) {
      setError(err.message || "Failed to add category");
    }
  }

  async function handleDelete(id) {
    if (!isAdmin) return;
    if (!window.confirm("Delete this category?")) return;

    setError("");
    try {
      await deleteCategory(id);
      // optimistic update (no refresh needed)
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err.message || "Failed to delete category");
    }
  }

  useEffect(() => {
    loadCategories();
  }, []);

  return (
    <div>
      <h1>Categories</h1>

      {isAdmin && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
          <input
            className="input"
            placeholder="Category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn" type="submit" style={{ marginLeft: 10 }}>
            Add
          </button>
        </form>
      )}

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      <ul style={{ paddingLeft: 18 }}>
        {categories.map((c) => (
          <li key={c.id} style={{ marginBottom: 8 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 80 }}>
              <span>{c.name}</span>

              {isAdmin && (
                <button
                  className="btn"
                  onClick={() => handleDelete(c.id)}
                  style={{ padding: "4px 10px", marginLeft: 6 }}
                  type="button"
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
