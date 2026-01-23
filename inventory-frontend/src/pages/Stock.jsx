import { useEffect, useMemo, useState } from "react";
import { getProducts, updateStock, getMovements, downloadStockCsv } from "../services/api";

export default function Stock({ user }) {
  const isAdmin = user?.role === "admin";

  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Stock update form
  const [form, setForm] = useState({
    product_id: "",
    type: "IN",
    quantity: 1,
    reason: "",
  });

  // ✅ Filters UI (for table + export)
  const [filters, setFilters] = useState({
    search: "",
    type: "", // "", "IN", "OUT"
    from: "", // YYYY-MM-DD
    to: "",   // YYYY-MM-DD
  });

  // Debounced search so typing doesn't feel laggy
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => window.clearTimeout(t);
  }, [filters.search]);

  const busy = loading || submitting || exporting;

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function loadAll() {
    setLoading(true);
    setError("");

    try {
      const [p, m] = await Promise.all([getProducts(), getMovements()]);
      setProducts(Array.isArray(p) ? p : []);
      setMovements(Array.isArray(m) ? m : []);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const canSubmit = useMemo(() => {
    const pid = Number(form.product_id);
    const qty = Number(form.quantity);
    return isAdmin && pid > 0 && qty > 0 && !busy;
  }, [form.product_id, form.quantity, isAdmin, busy]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!isAdmin) {
      setError("Admins only");
      return;
    }

    const pid = Number(form.product_id);
    const qty = Number(form.quantity);

    if (!pid) return setError("Select a product");
    if (!Number.isFinite(qty) || qty <= 0) return setError("Quantity must be greater than 0");

    setSubmitting(true);
    try {
      await updateStock({
        product_id: pid,
        type: form.type,
        quantity: qty,
        reason: String(form.reason || "").trim(),
      });

      setForm({
        product_id: "",
        type: "IN",
        quantity: 1,
        reason: "",
      });

      await loadAll();
    } catch (e2) {
      setError(e2.message || "Update stock failed");
    } finally {
      setSubmitting(false);
    }
  }

  // ✅ Export uses filter params
  async function handleExportStockCsv() {
    setError("");
    setExporting(true);
    try {
      const params = {
        search: String(filters.search || "").trim(),
        type: String(filters.type || "").trim(),
        from: String(filters.from || "").trim(),
        to: String(filters.to || "").trim(),
      };
      await downloadStockCsv(params);
    } catch (e) {
      setError(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    setFilters({ search: "", type: "", from: "", to: "" });
  }

  // ✅ Client-side filtered movements (so UI updates instantly)
  const filteredMovements = useMemo(() => {
    const s = String(debouncedSearch || "").trim().toLowerCase();
    const type = String(filters.type || "").trim().toUpperCase();
    const from = String(filters.from || "").trim();
    const to = String(filters.to || "").trim();

    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59`).getTime() : null;

    return (movements || []).filter((m) => {
      // type
      if (type && String(m.type || "").toUpperCase() !== type) return false;

      // date range
      const ts = m.created_at ? new Date(m.created_at).getTime() : null;
      if (fromMs != null && ts != null && ts < fromMs) return false;
      if (toMs != null && ts != null && ts > toMs) return false;

      // search
      if (s) {
        const hay = [
          m.product_name,
          m.sku, // if your API includes it (safe if undefined)
          m.reason,
          m.type,
        ]
          .map((x) => String(x || "").toLowerCase())
          .join(" ");
        if (!hay.includes(s)) return false;
      }

      return true;
    });
  }, [movements, debouncedSearch, filters.type, filters.from, filters.to]);

  return (
    <div>
      {/* Header row with Export CSV */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Stock In / Out</h1>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            Showing {filteredMovements.length} movement(s)
          </div>
        </div>

        <button className="btn" onClick={handleExportStockCsv} disabled={busy}>
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      {/* ✅ Filters UI */}
      <div
        style={{
          marginTop: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          background: "#f9fafb",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="input"
            placeholder="Search (product, reason, type)"
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            disabled={busy}
            style={{ minWidth: 260, flex: "1 1 260px" }}
          />

          <select
            className="input"
            value={filters.type}
            onChange={(e) => updateFilter("type", e.target.value)}
            disabled={busy}
            style={{ minWidth: 140 }}
          >
            <option value="">All Types</option>
            <option value="IN">IN</option>
            <option value="OUT">OUT</option>
          </select>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#374151" }}>From</div>
            <input
              className="input"
              type="date"
              value={filters.from}
              onChange={(e) => updateFilter("from", e.target.value)}
              disabled={busy}
            />
            <div style={{ fontSize: 12, color: "#374151" }}>To</div>
            <input
              className="input"
              type="date"
              value={filters.to}
              onChange={(e) => updateFilter("to", e.target.value)}
              disabled={busy}
            />
          </div>

          <button className="btn" onClick={clearFilters} disabled={busy}>
            Clear
          </button>
        </div>

        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Export uses these filters too.
        </div>
      </div>

      {/* ADMIN FORM */}
      {isAdmin && (
        <form
          onSubmit={handleSubmit}
          style={{
            display: "grid",
            gap: 10,
            maxWidth: 600,
            marginTop: 14,
            marginBottom: 20,
            opacity: busy ? 0.85 : 1,
          }}
        >
          <select
            className="input"
            value={form.product_id}
            onChange={(e) => updateField("product_id", e.target.value)}
            disabled={busy}
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
              disabled={busy}
            >
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>

            <input
              className="input"
              type="number"
              min="1"
              value={form.quantity}
              onChange={(e) => updateField("quantity", Number(e.target.value))}
              placeholder="Quantity"
              disabled={busy}
            />
          </div>

          <input
            className="input"
            value={form.reason}
            onChange={(e) => updateField("reason", e.target.value)}
            placeholder="Reason (e.g., Restock, Sale, Damage)"
            disabled={busy}
          />

          <button className="btn" type="submit" disabled={!canSubmit}>
            {submitting ? "Updating..." : "Update Stock"}
          </button>
        </form>
      )}

      {/* STATUS */}
      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {/* MOVEMENTS TABLE */}
      <h2 style={{ marginTop: 10 }}>Recent Movements</h2>

      <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
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
          {filteredMovements.map((m) => (
            <tr key={m.id}>
              <td>{m.product_name}</td>
              <td>{m.type}</td>
              <td>{m.quantity}</td>
              <td>{m.reason || "-"}</td>
              <td>{m.created_at ? new Date(m.created_at).toLocaleString() : "-"}</td>
            </tr>
          ))}

          {!loading && filteredMovements.length === 0 && (
            <tr>
              <td colSpan="5" style={{ textAlign: "center" }}>
                No movements match your filters
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
