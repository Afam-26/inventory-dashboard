import { useEffect, useMemo, useState } from "react";
import {
  getProducts,
  addProduct,
  getCategories,
  updateProduct,
  deleteProduct,
  downloadProductsCsv,
  importProductsRows,
} from "../services/api";

/* ============================
   CSV helpers (no libraries)
============================ */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((x) => String(x).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.some((x) => String(x).trim() !== "")) rows.push(row);

  return rows;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function downloadTextFile(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toNumberOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function guessMapping(headers) {
  const norm = headers.map((h) => String(h || "").trim().toLowerCase());
  const find = (...cands) => {
    for (const c of cands) {
      const idx = norm.indexOf(c);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  return {
    name: find("name", "product name", "product"),
    sku: find("sku", "product sku", "code"),
    category: find("category", "category name"),
    quantity: find("quantity", "qty", "stock"),
    cost_price: find("cost_price", "cost price", "cost"),
    selling_price: find("selling_price", "selling price", "price", "sale price"),
    reorder_level: find("reorder_level", "reorder level", "reorder"),
  };
}

export default function Products({ user }) {
  const isAdmin = user?.role === "admin";

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // ✅ disable per-row buttons while saving/deleting
  const [savingId, setSavingId] = useState(null);

  // ✅ per-row error messages
  const [rowErrors, setRowErrors] = useState({}); // { [productId]: string }

  // Search
  const [search, setSearch] = useState("");

  // edit
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  // delete confirm
  const [confirmDelete, setConfirmDelete] = useState(null);

  // undo delete
  const [undo, setUndo] = useState(null);

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

  /* ============================
     CSV import state
  ============================ */
  const [csvFileName, setCsvFileName] = useState("");
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]); // raw rows (no header)

  const [mapping, setMapping] = useState({
    name: -1,
    sku: -1,
    category: -1,
    quantity: -1,
    cost_price: -1,
    selling_price: -1,
    reorder_level: -1,
  });

  const [createMissingCategories, setCreateMissingCategories] = useState(true);

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importMsg, setImportMsg] = useState("");
  const [importErrors, setImportErrors] = useState([]); // { line, sku, message }
  const previewCount = 20;

  // ✅ helper: reset import UI (auto-clear)
  function resetImportUI({ keepMsg = false } = {}) {
    setCsvFileName("");
    setCsvHeaders([]);
    setCsvRows([]);
    setMapping({
      name: -1,
      sku: -1,
      category: -1,
      quantity: -1,
      cost_price: -1,
      selling_price: -1,
      reorder_level: -1,
    });
    setImportErrors([]);
    setImportProgress({ done: 0, total: 0 });
    if (!keepMsg) setImportMsg("");
  }

  async function loadAll(searchQuery = "") {
    setLoading(true);
    setError("");
    try {
      const [p, c] = await Promise.all([getProducts(searchQuery), getCategories()]);
      setProducts(Array.isArray(p) ? p : []);
      setCategories(Array.isArray(c) ? c : []);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => loadAll(search), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const anyBusy = loading || importing || savingId != null;

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

      await loadAll(search);
    } catch (e2) {
      setError(e2.message || "Create failed");
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
    setError("");

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
      await loadAll(search);
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
    setError("");

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
      setProducts((prev) => prev.filter((x) => x.id !== p.id));

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
      await loadAll(search);
    } catch (e) {
      setError(e.message || "Undo failed");
    }
  }

  async function handleExportCsv() {
    setError("");
    try {
      await downloadProductsCsv();
    } catch (e) {
      setError(e.message || "Export failed");
    }
  }

  /* ============================
     CSV Import: choose file
  ============================ */
  async function onChooseCsv(file) {
    if (!file) return;

    setError("");
    setImportMsg("");
    setImportErrors([]);
    setImportProgress({ done: 0, total: 0 });

    try {
      const text = await file.text();
      const parsed = parseCsv(text);

      if (parsed.length < 2) throw new Error("CSV must include header + at least 1 data row.");

      const headers = parsed[0].map((h) => String(h ?? "").trim());
      const rows = parsed.slice(1);

      setCsvFileName(file.name);
      setCsvHeaders(headers);
      setCsvRows(rows);

      const g = guessMapping(headers);
      setMapping({
        name: g.name,
        sku: g.sku,
        category: g.category,
        quantity: g.quantity,
        cost_price: g.cost_price,
        selling_price: g.selling_price,
        reorder_level: g.reorder_level,
      });
    } catch (e) {
      setError(e.message || "Failed to read CSV");
      resetImportUI();
    }
  }

  function buildRowObject(rawRow) {
    const get = (idx) => (idx >= 0 ? String(rawRow[idx] ?? "").trim() : "");
    return {
      name: get(mapping.name),
      sku: get(mapping.sku),
      category: get(mapping.category),
      quantity: get(mapping.quantity),
      cost_price: get(mapping.cost_price),
      selling_price: get(mapping.selling_price),
      reorder_level: get(mapping.reorder_level),
    };
  }

  // ✅ mapping duplicates check
  const mappingDupes = useMemo(() => {
    const keys = Object.keys(mapping);
    const used = new Map(); // idx -> [keys]
    for (const k of keys) {
      const idx = Number(mapping[k]);
      if (idx < 0) continue;
      const arr = used.get(idx) || [];
      arr.push(k);
      used.set(idx, arr);
    }
    const dupes = [];
    for (const [idx, ks] of used.entries()) {
      if (ks.length > 1) dupes.push({ idx, keys: ks });
    }
    return dupes;
  }, [mapping]);

  const validation = useMemo(() => {
    if (!csvRows.length) return { ok: false, issues: [], counts: { total: 0, bad: 0 } };

    const issues = [];
    let bad = 0;
    const total = csvRows.length;

    if (mapping.name < 0 || mapping.sku < 0) {
      return {
        ok: false,
        issues: [{ line: 1, sku: "", message: "Mapping required: name and sku must be selected." }],
        counts: { total, bad: total },
      };
    }

    if (mappingDupes.length) {
      return {
        ok: false,
        issues: [{ line: 1, sku: "", message: "Duplicate mapping: same CSV column mapped multiple times." }],
        counts: { total, bad: total },
      };
    }

    const skuSeen = new Map();

    for (let i = 0; i < csvRows.length; i++) {
      const line = i + 2;
      const obj = buildRowObject(csvRows[i]);

      const name = String(obj.name || "").trim();
      const sku = String(obj.sku || "").trim();

      if (!name || !sku) {
        bad++;
        issues.push({ line, sku, message: "Missing required: name or sku" });
        continue;
      }

      const skuKey = sku.toLowerCase();
      if (skuSeen.has(skuKey)) {
        bad++;
        issues.push({
          line,
          sku,
          message: `Duplicate SKU in file (first seen at line ${skuSeen.get(skuKey)})`,
        });
      } else {
        skuSeen.set(skuKey, line);
      }

      if (mapping.quantity >= 0 && toNumberOrNull(obj.quantity) === null) {
        bad++;
        issues.push({ line, sku, message: "Invalid number in quantity" });
      }
      if (mapping.cost_price >= 0 && toNumberOrNull(obj.cost_price) === null) {
        bad++;
        issues.push({ line, sku, message: "Invalid number in cost_price" });
      }
      if (mapping.selling_price >= 0 && toNumberOrNull(obj.selling_price) === null) {
        bad++;
        issues.push({ line, sku, message: "Invalid number in selling_price" });
      }
      if (mapping.reorder_level >= 0 && toNumberOrNull(obj.reorder_level) === null) {
        bad++;
        issues.push({ line, sku, message: "Invalid number in reorder_level" });
      }
    }

    return { ok: issues.length === 0, issues, counts: { total, bad } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvRows, mapping, mappingDupes]);

  const previewRows = useMemo(() => {
    return csvRows.slice(0, previewCount).map((r, i) => ({
      line: i + 2,
      obj: buildRowObject(r),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvRows, mapping]);

  function makePayloadFromObj(obj) {
    return {
      name: String(obj.name || "").trim(),
      sku: String(obj.sku || "").trim(),
      category: String(obj.category || "").trim(),
      quantity: mapping.quantity >= 0 ? Number(obj.quantity) || 0 : 0,
      cost_price: mapping.cost_price >= 0 ? Number(obj.cost_price) || 0 : 0,
      selling_price: mapping.selling_price >= 0 ? Number(obj.selling_price) || 0 : 0,
      reorder_level:
        mapping.reorder_level >= 0
          ? obj.reorder_level === ""
            ? 10
            : Number(obj.reorder_level) || 0
          : 10,
    };
  }

  async function startImport() {
    if (!isAdmin) return;
    if (!csvRows.length) return;

    setError("");
    setImportMsg("");
    setImportErrors([]);

    if (!validation.ok) {
      setError("Fix validation issues before importing (see Validation section).");
      return;
    }

    setImporting(true);

    try {
      const BATCH = 200;
      const total = csvRows.length;
      setImportProgress({ done: 0, total });

      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      const allErrs = [];

      for (let start = 0; start < total; start += BATCH) {
        const chunk = csvRows.slice(start, start + BATCH);
        const payload = chunk.map((raw) => makePayloadFromObj(buildRowObject(raw)));

        const result = await importProductsRows(payload, { createMissingCategories });

        inserted += Number(result.inserted || 0);
        updated += Number(result.updated || 0);
        skipped += Number(result.skipped || 0);

        if (Array.isArray(result.errors)) {
          for (const e of result.errors) {
            const idx = Number(e.index ?? -1);
            const line = idx >= 0 ? start + idx + 2 : "";
            allErrs.push({ line, sku: e.sku || "", message: e.message || "Error" });
          }
        }

        setImportProgress({ done: Math.min(start + chunk.length, total), total });
      }

      setImportErrors(allErrs);

      setImportMsg(
        `Import complete — inserted ${inserted}, updated ${updated}, skipped ${skipped}` +
          (allErrs.length ? ` (errors: ${allErrs.length})` : "")
      );

      await loadAll(search);

      // ✅ Auto-clear import panel a few seconds after completion
      window.setTimeout(() => {
        resetImportUI({ keepMsg: false });
      }, 6000);
    } catch (e) {
      setError(e.message || "Import failed");

      // optional: auto-clear error message after a bit
      window.setTimeout(() => {
        setError("");
      }, 6000);
    } finally {
      setImporting(false);
    }
  }

  function downloadErrorReport() {
    const combined = [
      ...validation.issues.map((x) => ({ source: "validation", ...x })),
      ...importErrors.map((x) => ({ source: "server", ...x })),
    ];

    if (!combined.length) return;

    const header = ["source", "line", "sku", "message"];
    const lines = [header.join(",")];

    for (const r of combined) {
      lines.push(
        [csvEscape(r.source), csvEscape(r.line), csvEscape(r.sku), csvEscape(r.message)].join(",")
      );
    }

    downloadTextFile("products_import_errors.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  const progressPct =
    importProgress.total > 0 ? Math.round((importProgress.done / importProgress.total) * 100) : 0;

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

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Search (name, SKU, category)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
            disabled={anyBusy}
          />

          <button className="btn" onClick={handleExportCsv} disabled={anyBusy}>
            Export CSV
          </button>

          {isAdmin && (
            <label
              className="btn"
              style={{ cursor: anyBusy ? "not-allowed" : "pointer", opacity: anyBusy ? 0.7 : 1 }}
            >
              Choose CSV
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                disabled={anyBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  onChooseCsv(f);
                }}
              />
            </label>
          )}

          {undo && Date.now() < undo.expiresAt && (
            <button className="btn" onClick={undoDelete} disabled={anyBusy}>
              Undo delete
            </button>
          )}
        </div>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {importMsg && <p style={{ color: "green" }}>{importMsg}</p>}

      {/* CSV Import Panel (admin only) */}
      {isAdmin && (
        <div
          style={{
            marginTop: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
            background: "#f9fafb",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800 }}>CSV Import</div>
              <div style={{ color: "#6b7280", fontSize: 12 }}>
                {csvFileName ? `Selected: ${csvFileName} (${csvRows.length} rows)` : "No file selected"}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={createMissingCategories}
                  onChange={(e) => setCreateMissingCategories(e.target.checked)}
                  disabled={anyBusy}
                />
                Auto-create missing categories
              </label>

              <button className="btn" onClick={startImport} disabled={anyBusy || !csvRows.length || !validation.ok}>
                {importing ? "Importing..." : "Start Import"}
              </button>

              <button
                className="btn"
                onClick={downloadErrorReport}
                disabled={anyBusy || (!importErrors.length && !validation.issues.length)}
                title="Download validation + server errors"
              >
                Download error report
              </button>
            </div>
          </div>

          {(importing || importProgress.total > 0) && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "#374151", marginBottom: 6 }}>
                Progress: {importProgress.done} / {importProgress.total} ({progressPct}%)
              </div>
              <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progressPct}%`, background: "#111827" }} />
              </div>
            </div>
          )}

          {csvHeaders.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Column Mapping</div>

              {mappingDupes.length > 0 && (
                <div style={{ marginBottom: 10, fontSize: 12, color: "#991b1b" }}>
                  Duplicate mapping detected: you mapped the same column to multiple fields. Fix this to proceed.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {[
                  ["name", "Name (required)"],
                  ["sku", "SKU (required)"],
                  ["category", "Category"],
                  ["quantity", "Quantity"],
                  ["cost_price", "Cost Price"],
                  ["selling_price", "Selling Price"],
                  ["reorder_level", "Reorder Level"],
                ].map(([key, label]) => (
                  <div key={key} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 170, fontSize: 12, color: "#374151" }}>{label}</div>
                    <select
                      className="input"
                      value={mapping[key]}
                      disabled={anyBusy}
                      onChange={(e) => setMapping((m) => ({ ...m, [key]: Number(e.target.value) }))}
                    >
                      <option value={-1}>— Not mapped —</option>
                      {csvHeaders.map((h, idx) => (
                        <option key={idx} value={idx}>
                          {h || `(Column ${idx + 1})`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 10, fontSize: 12 }}>
                <b>Validation:</b>{" "}
                {!validation.ok ? (
                  <span style={{ color: "#b45309" }}>
                    {validation.issues.length} issue(s) found — fix them to import.
                  </span>
                ) : (
                  <span style={{ color: "#065f46" }}>No issues found.</span>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Preview (first {previewCount} rows)</div>
                <div style={{ overflowX: "auto" }}>
                  <table
                    border="1"
                    cellPadding="8"
                    style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}
                  >
                    <thead style={{ background: "#f3f4f6" }}>
                      <tr>
                        <th>Line</th>
                        <th>Name</th>
                        <th>SKU</th>
                        <th>Category</th>
                        <th>Qty</th>
                        <th>Cost</th>
                        <th>Selling</th>
                        <th>Reorder</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r) => (
                        <tr key={r.line}>
                          <td>{r.line}</td>
                          <td>{r.obj.name}</td>
                          <td>{r.obj.sku}</td>
                          <td>{r.obj.category}</td>
                          <td>{r.obj.quantity}</td>
                          <td>{r.obj.cost_price}</td>
                          <td>{r.obj.selling_price}</td>
                          <td>{r.obj.reorder_level}</td>
                        </tr>
                      ))}
                      {!previewRows.length && (
                        <tr>
                          <td colSpan={8} style={{ textAlign: "center" }}>
                            No preview available
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {validation.issues.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, color: "#b45309" }}>
                      Validation issues (first 10)
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#92400e" }}>
                      {validation.issues.slice(0, 10).map((x, i) => (
                        <li key={i}>
                          Line {x.line} {x.sku ? `(SKU: ${x.sku})` : ""}: {x.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {importErrors.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, color: "#991b1b" }}>
                      Import errors (first 10)
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#991b1b" }}>
                      {importErrors.slice(0, 10).map((x, i) => (
                        <li key={i}>
                          Line {x.line} {x.sku ? `(SKU: ${x.sku})` : ""}: {x.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Admin create form */}
      {isAdmin && (
        <form
          onSubmit={handleCreate}
          style={{ display: "grid", gap: 10, maxWidth: 650, marginBottom: 20, marginTop: 14 }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <input
              className="input"
              placeholder="Product name"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              disabled={anyBusy}
            />
            <input
              className="input"
              placeholder="SKU"
              value={form.sku}
              onChange={(e) => updateField("sku", e.target.value)}
              disabled={anyBusy}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <select
              className="input"
              value={form.category_id}
              onChange={(e) => updateField("category_id", e.target.value)}
              disabled={anyBusy}
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
              disabled={anyBusy}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <input
              className="input"
              type="number"
              placeholder="Cost price"
              value={form.cost_price}
              onChange={(e) => updateField("cost_price", e.target.value)}
              disabled={anyBusy}
            />
            <input
              className="input"
              type="number"
              placeholder="Selling price"
              value={form.selling_price}
              onChange={(e) => updateField("selling_price", e.target.value)}
              disabled={anyBusy}
            />
            <input
              className="input"
              type="number"
              placeholder="Reorder level"
              value={form.reorder_level}
              onChange={(e) => updateField("reorder_level", e.target.value)}
              disabled={anyBusy}
            />
          </div>

          <button className="btn" type="submit" disabled={anyBusy}>
            Add Product
          </button>
        </form>
      )}

      {loading && <p>Loading...</p>}

      {/* Products table */}
      <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
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
                      disabled={isSaving}
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
                      disabled={isSaving}
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
                      disabled={isSaving}
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
                <td>{p.cost_price}</td>
                <td>{p.selling_price}</td>
                <td>{p.reorder_level}</td>

                {isAdmin && (
                  <td style={{ minWidth: 240 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {!isEditing ? (
                        <button className="btn" onClick={() => startEdit(p)} disabled={anyBusy}>
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

                      <button className="btn" onClick={() => askDelete(p)} disabled={anyBusy}>
                        Delete
                      </button>
                    </div>

                    {inlineErr ? (
                      <div style={{ marginTop: 6, color: "#991b1b", fontSize: 12 }}>{inlineErr}</div>
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

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div style={overlayStyle} onMouseDown={() => (savingId ? null : setConfirmDelete(null))}>
          <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px" }}>Delete product?</h2>
            <p style={{ marginTop: 0, color: "#374151" }}>This will permanently delete:</p>

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
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={savingId != null}>
                Cancel
              </button>
              <button className="btn" onClick={confirmDeleteNow} disabled={savingId != null}>
                {savingId === confirmDelete.id ? "Deleting..." : "Confirm delete"}
              </button>
            </div>

            {rowErrors[confirmDelete.id] ? (
              <div style={{ marginTop: 10, color: "#991b1b", fontSize: 12 }}>
                {rowErrors[confirmDelete.id]}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
