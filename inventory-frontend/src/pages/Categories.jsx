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
      setCategories(data);
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
    }
  }

  async function handleDelete(cat) {
    if (!isAdmin) return;

    const ok = window.confirm(`Delete category "${cat.name}"?`);
    if (!ok) return;

    setError("");
    try {
      await deleteCategory(cat.id);
      await loadCategories();
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
          <li
            key={c.id}
            style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}
          >
            <span>{c.name}</span>

            {isAdmin && (
              <button className="btn" onClick={() => handleDelete(c)} style={{ marginLeft: "auto" }}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
