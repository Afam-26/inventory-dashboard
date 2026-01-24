// src/pages/Stock.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getProducts,
  updateStock,
  getMovements,
  downloadStockCsv,
  getProductBySku,
} from "../services/api";

export default function Stock({ user }) {
  const isAdmin = user?.role === "admin";

  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Barcode scanner modal
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [lastScan, setLastScan] = useState("");

  // Stock update form
  const [form, setForm] = useState({
    product_id: "",
    type: "IN",
    quantity: 1,
    reason: "",
  });

  // ✅ Filters UI (for table + export + server query)
  const [filters, setFilters] = useState({
    search: "",
    type: "", // "", "IN", "OUT"
    from: "", // YYYY-MM-DD
    to: "", // YYYY-MM-DD
  });

  // Debounce typing for server fetch
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => window.clearTimeout(t);
  }, [filters.search]);

  const busy = loading || submitting || exporting;

  // Track latest request to prevent race-condition overwrites
  const movementsReqId = useRef(0);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters() {
    setFilters({ search: "", type: "", from: "", to: "" });
  }

  // ---------------------------
  // Scanner helpers (Quagga)
  // ---------------------------
  function stopScanner() {
    try {
      const Q = window.Quagga;
      if (Q) {
        Q.offDetected();
        Q.stop();
      }
    } catch {
      // Scanner may already be stopped – safe to ignore
    }
  }

  async function handleDetectedSku(skuRaw) {
    const sku = String(skuRaw || "").trim();
    if (!sku) return;

    // prevent repeated rapid triggers
    if (sku === lastScan) return;
    setLastScan(sku);

    setScanError("");
    try {
      const found = await getProductBySku(sku);

      setForm((prev) => ({
        ...prev,
        product_id: String(found.id),
      }));

      setScannerOpen(false);
      stopScanner();
    } catch (e) {
      setScanError(e.message || "Not found");
    }
  }

  useEffect(() => {
    if (!scannerOpen) return;

    setScanError("");
    setLastScan("");

    const Q = window.Quagga;
    if (!Q) {
      setScanError("Scanner library not loaded (Quagga). Check index.html script tag.");
      return;
    }

    Q.init(
      {
        inputStream: {
          type: "LiveStream",
          target: document.querySelector("#barcode-scanner"),
          constraints: { facingMode: "environment" },
        },
        decoder: {
          readers: [
            "ean_reader",
            "ean_8_reader",
            "upc_reader",
            "upc_e_reader",
            "code_128_reader",
            "code_39_reader",
          ],
        },
        locate: true,
      },
      (err) => {
        if (err) {
          setScanError(err.message || "Failed to start camera");
          return;
        }

        Q.start();

        Q.onDetected((data) => {
          const code = data?.codeResult?.code;
          if (code) handleDetectedSku(code);
        });
      }
    );

    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen]);

  // ---------------------------
  // Load products once
  // ---------------------------
  async function loadProductsOnly() {
    try {
      const p = await getProducts("");
      setProducts(Array.isArray(p) ? p : []);
    } catch (e) {
      setError(e.message || "Failed to load products");
    }
  }

  // ---------------------------
  // Load movements (server-side filters)
  // ---------------------------
  async function loadMovementsServer(params) {
    const myReq = ++movementsReqId.current;

    try {
      const m = await getMovements(params);
      // ignore if an even newer request finished later
      if (myReq !== movementsReqId.current) return;

      setMovements(Array.isArray(m) ? m : []);
    } catch (e) {
      if (myReq !== movementsReqId.current) return;
      setError(e.message || "Failed to load movements");
      setMovements([]);
    }
  }

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        await Promise.all([
          loadProductsOnly(),
          loadMovementsServer({ limit: 200 }),
        ]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When filters change, re-fetch movements from server (debounced search)
  useEffect(() => {
    // Don’t block typing; just fetch in background while keeping UI responsive
    // We still show busy state only for export/submit, not for filter fetch.
    setError("");

    loadMovementsServer({
      search: debouncedSearch,
      type: filters.type,
      from: filters.from,
      to: filters.to,
      limit: 500, // more rows for better filtering UX
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, filters.type, filters.from, filters.to]);

  const canSubmit = useMemo(() => {
    const pid = Number(form.product_id);
    const qty = Number(form.quantity);
    return isAdmin && pid > 0 && Number.isFinite(qty) && qty > 0 && !busy;
  }, [form.product_id, form.quantity, isAdmin, busy]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!isAdmin) return setError("Admins only");

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

      setForm({ product_id: "", type: "IN", quantity: 1, reason: "" });

      // refresh products (for updated stock counts) + movements with current filters
      await Promise.all([
        loadProductsOnly(),
        loadMovementsServer({
          search: debouncedSearch,
          type: filters.type,
          from: filters.from,
          to: filters.to,
          limit: 500,
        }),
      ]);
    } catch (e2) {
      setError(e2.message || "Update stock failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExportStockCsv() {
    setError("");
    setExporting(true);
    try {
      await downloadStockCsv({
        search: String(filters.search || "").trim(),
        type: String(filters.type || "").trim(),
        from: String(filters.from || "").trim(),
        to: String(filters.to || "").trim(),
      });
    } catch (e) {
      setError(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  // Server already filtered results; keep as-is
  const filteredMovements = useMemo(() => movements || [], [movements]);

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
            placeholder="Search (product, SKU, reason)"
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

        <div style={{ fontSize: 12, color: "#6b7280" }}>Export uses these filters too.</div>
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
            opacity: busy ? 0.9 : 1,
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

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn" type="button" onClick={() => setScannerOpen(true)} disabled={busy}>
              Scan barcode
            </button>
            <div style={{ fontSize: 12, color: "#6b7280" }}>(Tip: works best on phone camera)</div>
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

      {/* Scanner Modal */}
      {scannerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onMouseDown={() => {
            setScannerOpen(false);
            stopScanner();
          }}
        >
          <div
            style={{
              width: 520,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 14,
              padding: 12,
              border: "1px solid rgba(17,24,39,.10)",
              boxShadow: "0 20px 60px rgba(0,0,0,.25)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 900 }}>Scan Barcode</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Point camera at barcode. Detected SKU will auto-select product.
                </div>
              </div>

              <button
                className="btn"
                type="button"
                onClick={() => {
                  setScannerOpen(false);
                  stopScanner();
                }}
              >
                Close
              </button>
            </div>

            {scanError && <div style={{ marginTop: 10, color: "#991b1b", fontSize: 12 }}>{scanError}</div>}

            <div
              id="barcode-scanner"
              style={{
                marginTop: 12,
                width: "100%",
                height: 320,
                borderRadius: 12,
                overflow: "hidden",
                background: "#111827",
              }}
            />

            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Last scan: <b>{lastScan || "-"}</b>
            </div>
          </div>
        </div>
      )}

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
