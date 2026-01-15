import { useEffect, useState } from "react";
import {
  getProducts,
  addProduct,
  getCategories,
  updateProduct,
  deleteProduct,
} from "../services/api";

export default function Products({ user }) {
  const isAdmin = user?.role === "admin";

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [savingId, setSavingId] = useState(null); // product id being saved/deleted
  const [rowErrors, setRowErrors] = useState({}); // { [productId]: "msg" }

  // edit state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  // delete confirm modal state
  const [confirmDelete, setConfirmDelete] = useState(null); // product object

  // undo delete (store last deleted product payload for quick restore)
  const [undo, setUndo] = useState(null); // { payload, expiresAt }

  // create form (admin only)
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
      setProducts(Array.isArray(p) ? p : []);
      setCategories(Array.isArray(c) ? c : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e) {
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
    } catch (e2) {
      setError(e2.message);
    }
  }

  function startEdit(p) {
    setRowErrors((prev) => ({ ...prev, [p.id]: "" }));
    setEditingId(p.id);
    setEditForm({
      name: p.name || "",
      sku: p.sku || "",
      category_id: p.category_id ?? "",
      cost_price: p.cost_price ?? 0,
      selling_price: p.selling_price ?? 0,
      reorder_level: p.reorder_level ?? 0,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  async function saveEdit(id) {
    if (!editForm) return;

    setSavingId(id);
    setRowErrors((prev) => ({ ...prev, [id]: "" }));

    try {
      const payload = {
        name: String(editForm.name || "").trim(),
        sku: String(editForm.sku || "").trim(),
        category_id:
          editForm.category_id === "" || editForm.category_id == null
            ? null
            : Number(editForm.category_id),
        cost_price: Number(editForm.cost_price) || 0,
        selling_price: Number(editForm.selling_price) || 0,
        reorder_level: Number(editForm.reorder_level) || 0,
      };

      await updateProduct(id, payload);

      // refresh list
      await loadAll();
      cancelEdit();
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [id]: e.message || "Update failed" }));
    } finally {
      setSavingId(null);
    }
  }

  function askDelete(p) {
    setRowErrors((prev) => ({ ...prev, [p.id]: "" }));
    setConfirmDelete(p);
  }

  async function confirmDeleteNow() {
    if (!confirmDelete) return;
    const p = confirmDelete;

    setConfirmDelete(null);
    setSavingId(p.id);
    setRowErrors((prev) => ({ ...prev, [p.id]: "" }));

    // store undo payload (best effort)
    const undoPayload = {
      name: p.name,
      sku: p.sku,
      category_id: p.category_id ?? null,
      quantity: p.quantity ?? 0,
      cost_price: p.cost_price ?? 0,
      selling_price: p.selling_price ?? 0,
      reorder_level: p.reorder_level ?? 0,
    };

    try {
      await deleteProduct(p.id);

      // optimistic remove
      setProducts((prev) => prev.filter((x) => x.id !== p.id));

      // enable undo for 10 seconds
      const expiresAt = Date.now() + 10_000;
      setUndo({ payload: undoPayload, expiresAt });

      window.setTimeout(() => {
        setUndo((u) => {
          if (!u) return null;
          return Date.now() > u.expiresAt ? null : u;
        });
      }, 10_200);
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [p.id]: e.message || "Delete failed" }));
    } finally {
      setSavingId(null);
    }
  }

  async function undoDelete() {
    if (!undo) return;

    setError("");
    try {
      await addProduct(undo.payload);
      setUndo(null);
      await loadAll();
    } catch (e) {
      setError(e.message || "Undo failed");
    }
  }

  const overlayStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.45)",
    zIndex: 10000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };

  const modalStyle = {
    width: 520,
    maxWidth: "100%",
    background: "#fff",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 20px 60px rgba(0,0,0,.25)",
    border: "1px solid rgba(17,24,39,.08)",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12 }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Products</h1>
          {!isAdmin && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 999,
                background: "#111827",
                color: "#fff",
                fontSize: 12,
              }}
            >
              Read-only (Staff)
            </div>
          )}
        </div>

        {undo && Date.now() < undo.expiresAt && (
          <button className="btn" onClick={undoDelete}>
            Undo delete
          </button>
        )}
      </div>

      {/* Admin create form */}
      {isAdmin && (
        <form
          onSubmit={handleCreate}
          style={{ display: "grid", gap: 10, maxWidth: 650, marginBottom: 20 }}
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

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div style={overlayStyle} onMouseDown={() => setConfirmDelete(null)}>
          <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px" }}>Delete product?</h2>
            <p style={{ marginTop: 0, color: "#374151" }}>
              This will permanently delete:
            </p>

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                background: "#f9fafb",
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 800 }}>{confirmDelete.name}</div>
              <div style={{ color: "#6b7280" }}>SKU: {confirmDelete.sku}</div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn" onClick={confirmDeleteNow}>
                Confirm delete
              </button>
            </div>
          </div>
        </div>
      )}

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
            {isAdmin && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {products.map((p) => {
            const isEditing = editingId === p.id;
            const isSaving = savingId === p.id;
            const inlineErr = rowErrors[p.id];

            return (
              <tr key={p.id}>
                <td>
                  {isEditing ? (
                    <input
                      className="input"
                      value={editForm?.name ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  ) : (
                    p.name
                  )}
                </td>

                <td>
                  {isEditing ? (
                    <input
                      className="input"
                      value={editForm?.sku ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, sku: e.target.value }))}
                    />
                  ) : (
                    p.sku
                  )}
                </td>

                <td>
                  {isEditing ? (
                    <select
                      className="input"
                      value={editForm?.category_id ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, category_id: e.target.value }))}
                    >
                      <option value="">None</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    p.category ?? "-"
                  )}
                </td>

                <td>{p.quantity}</td>

                <td>
                  {isEditing ? (
                    <input
                      className="input"
                      type="number"
                      value={editForm?.cost_price ?? 0}
                      onChange={(e) => setEditForm((f) => ({ ...f, cost_price: e.target.value }))}
                      style={{ maxWidth: 120 }}
                    />
                  ) : (
                    p.cost_price
                  )}
                </td>

                <td>
                  {isEditing ? (
                    <input
                      className="input"
                      type="number"
                      value={editForm?.selling_price ?? 0}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, selling_price: e.target.value }))
                      }
                      style={{ maxWidth: 120 }}
                    />
                  ) : (
                    p.selling_price
                  )}
                </td>

                <td>
                  {isEditing ? (
                    <input
                      className="input"
                      type="number"
                      value={editForm?.reorder_level ?? 0}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, reorder_level: e.target.value }))
                      }
                      style={{ maxWidth: 120 }}
                    />
                  ) : (
                    p.reorder_level
                  )}
                </td>

                {isAdmin && (
                  <td style={{ minWidth: 220 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {!isEditing ? (
                        <button className="btn" onClick={() => startEdit(p)} disabled={isSaving}>
                          Edit
                        </button>
                      ) : (
                        <>
                          <button className="btn" onClick={() => saveEdit(p.id)} disabled={isSaving}>
                            {isSaving ? "Saving..." : "Save"}
                          </button>
                          <button className="btn" onClick={cancelEdit} disabled={isSaving}>
                            Cancel
                          </button>
                        </>
                      )}

                      <button className="btn" onClick={() => askDelete(p)} disabled={isSaving}>
                        Delete
                      </button>
                    </div>

                    {inlineErr ? (
                      <div style={{ marginTop: 6, color: "#991b1b", fontSize: 12 }}>
                        {inlineErr}
                      </div>
                    ) : null}
                  </td>
                )}
              </tr>
            );
          })}

          {!loading && products.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 8 : 7} style={{ textAlign: "center" }}>
                No products yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
