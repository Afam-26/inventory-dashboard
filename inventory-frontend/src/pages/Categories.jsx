import { useEffect, useState } from "react";
import { getCategories, addCategory } from "../services/api";




export default function Categories({user}) {
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
      loadCategories();
    } catch (err) {
      setError(err.message);
    }
  }
  

  useEffect(() => {
    loadCategories();
  }, []);

  return (
    <div>
      <h1>Categories</h1>
      {isAdmin && (<form onSubmit={handleSubmit}>

      <form onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
        <input
          className="input"
          placeholder="Category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn" style={{ marginLeft: 10 }}>
          Add
        </button>
      </form>
      </form>)}

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
     

      <ul>
        {categories.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>  
     

    </div>
  );
}


