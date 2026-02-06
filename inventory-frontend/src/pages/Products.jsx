// src/pages/Products.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getProducts,
  addProduct,
  getCategories,
  updateProduct,
  deleteProduct,
  downloadProductsCsv,
  importProductsRows,
  getSettings,
  updateLowStockThreshold,
  // ✅ NEW
  restoreProduct,
  hardDeleteProduct,
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
    barcode: find("barcode", "upc", "ean"),
    category: find("category", "category name"),
    quantity: find("quantity", "qty", "stock"),
    cost_price: find("cost_price", "cost price", "cost"),
    selling_price: find("selling_price", "selling price", "price", "sale price"),
    reorder_level: find("reorder_level", "reorder level", "reorder"),
  };
}

/* ============================
   LOW stock + urgency sorting
============================ */
function getThresholdForProduct(p, tenantDefault = 10) {
  const r = Number(p?.reorder_level ?? 0);
  return Number.isFinite(r) && r > 0 ? r : tenantDefault;
}

function isLowStock(p, tenantDefault = 10) {
  const qty = Number(p?.quantity ?? 0);
  const threshold = getThresholdForProduct(p, tenantDefault);
  return qty <= threshold;
}

function urgencyScore(p, tenantDefault = 10) {
  const qty = Number(p?.quantity ?? 0);
  const threshold = getThresholdForProduct(p, tenantDefault);
  return qty - threshold;
}

function sortProductsUrgentFirst(list, tenantDefault = 10) {
  return [...list].sort((a, b) => {
    const aLow = isLowStock(a, tenantDefault) ? 1 : 0;
    const bLow = isLowStock(b, tenantDefault) ? 1 : 0;

    if (aLow !== bLow) return bLow - aLow;

    const au = urgencyScore(a, tenantDefault);
    const bu = urgencyScore(b, tenantDefault);
    if (au !== bu) return au - bu;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function isDeleted(p) {
  return Boolean(p?.deleted_at);
}

export default function Products({ user }) {
  const role = String(user?.tenantRole || user?.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "owner";
  const isOwner = role === "owner";

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [savingId, setSavingId] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  const [search, setSearch] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const [confirmDelete, setConfirmDelete] = useState(null);

  // ✅ NEW: permanent delete confirm modal (owner-only)
  const [confirmHardDelete, setConfirmHardDelete] = useState(null);

  // ✅ NEW: Undo now restores a soft-deleted product (store id, not payload)
  const [undo, setUndo] = useState(null);

  // ✅ NEW: View mode (Active / Deleted / All)
  const [viewMode, setViewMode] = useState("active"); // "active" | "deleted" | "all"

  // ✅ tenant default low threshold (owner/admin can change)
  const [lowThreshold, setLowThreshold] = useState(10);
  const [savingThreshold, setSavingThreshold] = useState(false);

  const [form, setForm] = useState({
    name: "",
    sku: "",
    barcode: "",
    category_id: "",
    quantity: "",
    cost_price: "",
    selling_price: "",
    reorder_level: "",
  });

  /* ============================
     Barcode scanner (Quagga global)
  ============================ */
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [lastScan, setLastScan] = useState("");

  function stopScanner() {
    try {
      const Q = window.Quagga;
      if (Q) {
        Q.offDetected();
        Q.stop();
      }
    } catch {
      // ignore
    }
  }

  async function handleDetectedCode(codeRaw) {
    const code = String(codeRaw || "").trim();
    if (!code) return;
    if (code === lastScan) return;
    setLastScan(code);

    setScanError("");
    setForm((prev) => ({ ...prev, barcode: code }));

    setScannerOpen(false);
    stopScanner();
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
          target: document.querySelector("#barcode-scanner-products"),
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
          if (code) handleDetectedCode(code);
        });
      }
    );

    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen]);

  /* ============================
     CSV import state
  ============================ */
  const [csvFileName, setCsvFileName] = useState("");
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);

  const [mapping, setMapping] = useState({
    name: -1,
    sku: -1,
    barcode: -1,
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
  const [importErrors, setImportErrors] = useState([]);
  const previewCount = 20;

  // field validation UI
  const [fieldErrors, setFieldErrors] = useState({});
  const nameRef = useRef(null);
  const skuRef = useRef(null);

  // optional: shake animation toggles
  const [shake, setShake] = useState({});

  // ✅ load tenant settings once
  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings?.();
        const v = Number(s?.low_stock_threshold);
        if (Number.isFinite(v) && v > 0) setLowThreshold(v);
      } catch {
        // keep default 10
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll(searchQuery = "", mode = viewMode) {
    setLoading(true);
    setError("");

    try {
      const onlyDeleted = mode === "deleted";
      const includeDeleted = mode === "all";

      const [p, c] = await Promise.all([
        getProducts(searchQuery, { onlyDeleted, includeDeleted }),
        getCategories(),
      ]);

      const list = Array.isArray(p?.products) ? p.products : Array.isArray(p) ? p : [];
      const cats = Array.isArray(c?.categories) ? c.categories : Array.isArray(c) ? c : [];

      // For deleted/all views, do NOT urgency-sort (it’s weird for deleted rows)
      const finalList =
        mode === "active" ? sortProductsUrgentFirst(list, lowThreshold) : [...list].sort((a, b) => b.id - a.id);

      setProducts(finalList);
      setCategories(cats);
    } catch (e2) {
      setError(e2?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll("", viewMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // ✅ if threshold changes, re-sort current list immediately (active view only)
  useEffect(() => {
    if (viewMode !== "active") return;
    setProducts((prev) => sortProductsUrgentFirst(prev, lowThreshold));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowThreshold, viewMode]);

  useEffect(() => {
    const t = window.setTimeout(() => loadAll(search, viewMode), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, viewMode]);

  const anyBusy = loading || importing || savingId != null || savingThreshold;

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));

    if (error) setError("");

    setFieldErrors((prev) => {
      if (!prev?.[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    setShake((prev) => ({ ...prev, [key]: false }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const name = String(form.name || "").trim();
    const sku = String(form.sku || "").trim();

    const errs = {};
    if (!name) errs.name = "Product name is required.";
    if (!sku) errs.sku = "SKU is required.";

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      const firstKey = Object.keys(errs)[0];
      setError(errs[firstKey]);
      if (firstKey === "name") nameRef.current?.focus();
      if (firstKey === "sku") skuRef.current?.focus();
      setShake({ name: !!errs.name, sku: !!errs.sku });
      window.setTimeout(() => setShake({}), 420);
      return;
    }

    try {
      await addProduct({
        ...form,
        name,
        sku,
        barcode: String(form.barcode || "").trim() || null,
        category_id: form.category_id ? Number(form.category_id) : null,
        quantity: Number(form.quantity) || 0,
        cost_price: Number(form.cost_price) || 0,
        selling_price: Number(form.selling_price) || 0,
        // ✅ blank -> 0 (uses tenant default threshold)
        reorder_level: Number(form.reorder_level) || 0,
      });

      setForm({
        name: "",
        sku: "",
        barcode: "",
        category_id: "",
        quantity: "",
        cost_price: "",
        selling_price: "",
        reorder_level: "",
      });

      setFieldErrors({});
      setShake({});
      setError("");

      // after create, bounce to active view
      if (viewMode !== "active") setViewMode("active");
      await loadAll(search, "active");
    } catch (e2) {
      setError(e2?.message || "Create failed");
    }
  }

  function startEdit(p) {
    setRowErrors((prev) => ({ ...prev, [p.id]: "" }));
    setEditingId(p.id);
    setEditForm({
      name: p.name || "",
      sku: p.sku || "",
      barcode: p.barcode || "",
      category_id: p.category_id ?? "",
      quantity: p.quantity ?? 0,
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
        sku: String(editForm.sku || "").trim() || null,
        barcode: String(editForm.barcode || "").trim() || null,
        category_id:
          editForm.category_id === "" || editForm.category_id == null ? null : Number(editForm.category_id),
        quantity: Number(editForm.quantity) || 0,
        cost_price: Number(editForm.cost_price) || 0,
        selling_price: Number(editForm.selling_price) || 0,
        reorder_level: Number(editForm.reorder_level) || 0,
      };

      await updateProduct(id, payload);
      await loadAll(search, viewMode);
      cancelEdit();
    } catch (e2) {
      setRowErrors((prev) => ({ ...prev, [id]: e2?.message || "Update failed" }));
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

    try {
      await deleteProduct(p.id);

      // remove from UI (active view)
      setProducts((prev) => prev.filter((x) => x.id !== p.id));

      // ✅ Undo now restores the deleted product (within 10s)
      const expiresAt = Date.now() + 10_000;
      setUndo({ id: p.id, expiresAt });

      window.setTimeout(() => {
        setUndo((u) => {
          if (!u) return null;
          return Date.now() > u.expiresAt ? null : u;
        });
      }, 10_200);
    } catch (e2) {
      setRowErrors((prev) => ({ ...prev, [p.id]: e2?.message || "Delete failed" }));
    } finally {
      setSavingId(null);
    }
  }

  async function undoDelete() {
    if (!undo?.id) return;
    setError("");
    try {
      await restoreProduct(undo.id);
      setUndo(null);
      await loadAll(search, viewMode);
    } catch (e2) {
      setError(e2?.message || "Undo failed");
    }
  }

  function askHardDelete(p) {
    setRowErrors((prev) => ({ ...prev, [p.id]: "" }));
    setConfirmHardDelete(p);
  }

  async function confirmHardDeleteNow() {
    if (!confirmHardDelete) return;
    const p = confirmHardDelete;

    setConfirmHardDelete(null);
    setSavingId(p.id);
    setRowErrors((prev) => ({ ...prev, [p.id]: "" }));
    setError("");

    try {
      await hardDeleteProduct(p.id);
      setProducts((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e2) {
      setRowErrors((prev) => ({ ...prev, [p.id]: e2?.message || "Permanent delete failed" }));
    } finally {
      setSavingId(null);
    }
  }

  async function handleRestore(p) {
    setSavingId(p.id);
    setRowErrors((prev) => ({ ...prev, [p.id]: "" }));
    setError("");
    try {
      await restoreProduct(p.id);
      await loadAll(search, viewMode);
    } catch (e2) {
      setRowErrors((prev) => ({ ...prev, [p.id]: e2?.message || "Restore failed" }));
    } finally {
      setSavingId(null);
    }
  }

  async function handleExportCsv() {
    setError("");
    try {
      await downloadProductsCsv();
    } catch (e2) {
      setError(e2?.message || "Export failed");
    }
  }

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
        barcode: g.barcode,
        category: g.category,
        quantity: g.quantity,
        cost_price: g.cost_price,
        selling_price: g.selling_price,
        reorder_level: g.reorder_level,
      });
    } catch (e2) {
      setError(e2?.message || "Failed to read CSV");
      setCsvFileName("");
      setCsvHeaders([]);
      setCsvRows([]);
      setMapping({
        name: -1,
        sku: -1,
        barcode: -1,
        category: -1,
        quantity: -1,
        cost_price: -1,
        selling_price: -1,
        reorder_level: -1,
      });
    }
  }

  function buildRowObject(rawRow) {
    const get = (idx) => (idx >= 0 ? String(rawRow[idx] ?? "").trim() : "");
    return {
      name: get(mapping.name),
      sku: get(mapping.sku),
      barcode: get(mapping.barcode),
      category: get(mapping.category),
      quantity: get(mapping.quantity),
      cost_price: get(mapping.cost_price),
      selling_price: get(mapping.selling_price),
      reorder_level: get(mapping.reorder_level),
    };
  }

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
  }, [csvRows, mapping]);

  const previewRows = useMemo(() => {
    return csvRows.slice(0, previewCount).map((r, i) => ({
      line: i + 2,
      obj: buildRowObject(r),
    }));
  }, [csvRows, mapping]);

  function makePayloadFromObj(obj) {
    return {
      name: String(obj.name || "").trim(),
      sku: String(obj.sku || "").trim(),
      barcode: String(obj.barcode || "").trim(),
      category: String(obj.category || "").trim(),
      quantity: mapping.quantity >= 0 ? Number(obj.quantity) || 0 : 0,
      cost_price: mapping.cost_price >= 0 ? Number(obj.cost_price) || 0 : 0,
      selling_price: mapping.selling_price >= 0 ? Number(obj.selling_price) || 0 : 0,
      reorder_level:
        mapping.reorder_level >= 0 ? (obj.reorder_level === "" ? 0 : Number(obj.reorder_level) || 0) : 0,
    };
  }

  function clearImportUi() {
    setCsvFileName("");
    setCsvHeaders([]);
    setCsvRows([]);
    setMapping({
      name: -1,
      sku: -1,
      barcode: -1,
      category: -1,
      quantity: -1,
      cost_price: -1,
      selling_price: -1,
      reorder_level: -1,
    });
    setImportErrors([]);
    setImportProgress({ done: 0, total: 0 });
    setCreateMissingCategories(true);
  }

  async function startImport() {
    if (!isAdmin) return;
    if (!csvRows.length) return;

    setError("");
    setImportMsg("");
    setImportErrors([]);

    if (mapping.name < 0 || mapping.sku < 0) {
      setError("Please map required fields: name and sku.");
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
          for (const e2 of result.errors) {
            const idx = Number(e2.index ?? -1);
            const line = idx >= 0 ? start + idx + 2 : "";
            allErrs.push({ line, sku: e2.sku || "", message: e2.message || "Error" });
          }
        }

        setImportProgress({ done: Math.min(start + chunk.length, total), total });
      }

      setImportErrors(allErrs);

      setImportMsg(
        `Import complete — inserted ${inserted}, updated ${updated}, skipped ${skipped}` +
          (allErrs.length ? ` (errors: ${allErrs.length})` : "")
      );

      if (viewMode !== "active") setViewMode("active");
      await loadAll(search, "active");

      window.setTimeout(() => {
        setImportMsg("");
        clearImportUi();
      }, 3500);
    } catch (e2) {
      setError(e2?.message || "Import failed");
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
      lines.push([csvEscape(r.source), csvEscape(r.line), csvEscape(r.sku), csvEscape(r.message)].join(","));
    }

    downloadTextFile("products_import_errors.csv", lines.join("\n"), "text/csv;charset=utf-8");
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

  async function saveThreshold() {
    const v = Math.floor(Number(lowThreshold) || 10);
    if (!Number.isFinite(v) || v < 1) return setError("Low stock threshold must be >= 1");

    setSavingThreshold(true);
    setError("");
    try {
      const res = await updateLowStockThreshold?.(v);
      const saved = Number(res?.low_stock_threshold ?? v);
      setLowThreshold(Number.isFinite(saved) && saved > 0 ? saved : v);
      if (viewMode === "active") setProducts((prev) => sortProductsUrgentFirst(prev, Number.isFinite(saved) ? saved : v));
    } catch (e) {
      setError(e?.message || "Failed to save threshold");
    } finally {
      setSavingThreshold(false);
    }
  }

  return (
    <div className="products-page">
      <div className="products-header">
        <div>
          <h1 className="products-title">Products</h1>
          {!isAdmin && <div className="products-pill">Read-only (Staff)</div>}
        </div>

        <div className="products-actions">
          <input
            className="input"
            placeholder="Search (name, SKU, category)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={anyBusy}
          />

          <button className="btn" onClick={handleExportCsv} disabled={anyBusy}>
            Export CSV
          </button>

          {isAdmin && (
            <label className="btn products-fileBtn">
              Choose CSV
              <input
                type="file"
                accept=".csv,text/csv"
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

      {/* ✅ View mode tabs */}
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        {[
          { key: "active", label: "Active" },
          { key: "deleted", label: "Deleted" },
          { key: "all", label: "All" },
        ].map((t) => (
          <button
            key={t.key}
            className="btn"
            type="button"
            disabled={anyBusy}
            onClick={() => {
              setEditingId(null);
              setEditForm(null);
              setRowErrors({});
              setViewMode(t.key);
            }}
            style={{
              borderRadius: 999,
              fontWeight: 900,
              opacity: viewMode === t.key ? 1 : 0.7,
              outline: viewMode === t.key ? "2px solid #111827" : "none",
            }}
            title={t.key === "deleted" ? "Show soft-deleted products" : t.key === "all" ? "Show active + deleted" : ""}
          >
            {t.label}
          </button>
        ))}
        {viewMode !== "active" && (
          <div style={{ fontSize: 12, color: "#6b7280", alignSelf: "center" }}>
            Tip: Restore or permanently delete from this view.
          </div>
        )}
      </div>

      <br />
      {error && <p style={{ color: "red" }}>{error}</p>}
      {importMsg && <p style={{ color: "green" }}>{importMsg}</p>}

      {/* ✅ Low stock threshold control */}
      {isAdmin && (
        <div className="card" style={{ marginTop: 12, background: "#f9fafb" }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Low stock threshold</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="input"
              type="number"
              min={1}
              value={lowThreshold}
              onChange={(e) => setLowThreshold(Number(e.target.value) || 10)}
              style={{ width: 160 }}
              disabled={anyBusy}
            />
            <button className="btn" type="button" onClick={saveThreshold} disabled={anyBusy}>
              {savingThreshold ? "Saving..." : "Save"}
            </button>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Used when a product’s Reorder level is blank/0.
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Panel (admin only) */}
      {isAdmin && (
        <div className="products-import card" style={{ background: "#f9fafb" }}>
          <div className="products-importTop">
            <div>
              <div style={{ fontWeight: 800 }}>CSV Import</div>
              <div style={{ color: "#6b7280", fontSize: 12 }}>
                {csvFileName ? `Selected: ${csvFileName} (${csvRows.length} rows)` : "No file selected"}
              </div>
            </div>

            <div className="products-importActions">
              <label className="products-check">
                <input
                  type="checkbox"
                  checked={createMissingCategories}
                  onChange={(e) => setCreateMissingCategories(e.target.checked)}
                  disabled={anyBusy}
                />
                Auto-create missing categories
              </label>

              <button className="btn" onClick={startImport} disabled={anyBusy || !csvRows.length}>
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

          {importing && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "#374151", marginBottom: 6 }}>
                Importing {importProgress.done} / {importProgress.total}
              </div>
              <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width:
                      importProgress.total > 0
                        ? `${Math.round((importProgress.done / importProgress.total) * 100)}%`
                        : "0%",
                    background: "#111827",
                  }}
                />
              </div>
            </div>
          )}

          {csvHeaders.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Column Mapping</div>

              <div className="products-mapping">
                {[
                  ["name", "Name (required)"],
                  ["sku", "SKU (required)"],
                  ["barcode", "Barcode"],
                  ["category", "Category"],
                  ["quantity", "Quantity"],
                  ["cost_price", "Cost Price"],
                  ["selling_price", "Selling Price"],
                  ["reorder_level", "Reorder Level"],
                ].map(([key, label]) => (
                  <div key={key} className="products-mapRow">
                    <div className="products-mapLabel">{label}</div>
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
                {mapping.name < 0 || mapping.sku < 0 ? (
                  <span style={{ color: "#991b1b" }}>Map required fields (name, sku) to proceed.</span>
                ) : validation.issues.length ? (
                  <span style={{ color: "#b45309" }}>
                    {validation.issues.length} issue(s) found (import still allowed, bad rows may be skipped).
                  </span>
                ) : (
                  <span style={{ color: "#065f46" }}>No issues found.</span>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Preview (first {previewCount} rows)</div>
                <div className="products-tableWrap">
                  <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
                    <thead style={{ background: "#f3f4f6" }}>
                      <tr>
                        <th>Line</th>
                        <th>Name</th>
                        <th>SKU</th>
                        <th>Barcode</th>
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
                          <td>{r.obj.barcode}</td>
                          <td>{r.obj.category}</td>
                          <td>{r.obj.quantity}</td>
                          <td>{r.obj.cost_price}</td>
                          <td>{r.obj.selling_price}</td>
                          <td>{r.obj.reorder_level}</td>
                        </tr>
                      ))}
                      {!previewRows.length && (
                        <tr>
                          <td colSpan={9} style={{ textAlign: "center" }}>
                            No preview available
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {validation.issues.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: "#b45309" }}>Validation issues (first 10)</div>
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
                  <div style={{ fontWeight: 700, marginBottom: 6, color: "#991b1b" }}>Import errors (first 10)</div>
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
          )}
        </div>
      )}

      {/* Admin create form */}
      {isAdmin && (
        <form onSubmit={handleCreate} className="products-create card">
          <div className="products-formGrid">
            <div className="field">
              <input
                ref={nameRef}
                className={`input ${fieldErrors.name ? "input-error" : ""} ${shake?.name ? "input-shake" : ""}`}
                placeholder="Product name *"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                disabled={anyBusy}
                aria-invalid={Boolean(fieldErrors.name)}
              />
              {fieldErrors.name ? <div className="field-errorText">{fieldErrors.name}</div> : null}
            </div>

            <div className="field">
              <input
                ref={skuRef}
                className={`input ${fieldErrors.sku ? "input-error" : ""} ${shake?.sku ? "input-shake" : ""}`}
                placeholder="SKU *"
                value={form.sku}
                onChange={(e) => updateField("sku", e.target.value)}
                disabled={anyBusy}
                aria-invalid={Boolean(fieldErrors.sku)}
              />
              {fieldErrors.sku ? <div className="field-errorText">{fieldErrors.sku}</div> : null}
            </div>

            <div className="field">
              <input
                className="input"
                placeholder="Barcode"
                value={form.barcode}
                onChange={(e) => updateField("barcode", e.target.value)}
                disabled={anyBusy}
              />
            </div>

            <div className="field">
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
            </div>

            <div className="field">
              <input
                className="input"
                type="number"
                placeholder="Quantity"
                value={form.quantity}
                onChange={(e) => updateField("quantity", e.target.value)}
                disabled={anyBusy}
                inputMode="numeric"
              />
            </div>

            <div className="field">
              <input
                className="input"
                type="number"
                placeholder="Cost price"
                value={form.cost_price}
                onChange={(e) => updateField("cost_price", e.target.value)}
                disabled={anyBusy}
                inputMode="decimal"
              />
            </div>

            <div className="field">
              <input
                className="input"
                type="number"
                placeholder="Selling price"
                value={form.selling_price}
                onChange={(e) => updateField("selling_price", e.target.value)}
                disabled={anyBusy}
                inputMode="decimal"
              />
            </div>

            <div className="field">
              <input
                className="input"
                type="number"
                placeholder={`Reorder level (optional, default ${lowThreshold})`}
                value={form.reorder_level}
                onChange={(e) => updateField("reorder_level", e.target.value)}
                disabled={anyBusy}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="products-createActions">
            <button className="btn products-smallBtn" type="submit" disabled={anyBusy}>
              Add Product
            </button>

            <button
              className="btn products-smallBtn"
              type="button"
              disabled={anyBusy}
              onClick={() => setScannerOpen(true)}
            >
              Scan barcode
            </button>

            <div className="products-tip">(Tip: works best on phone camera)</div>
          </div>
        </form>
      )}

      {/* Barcode scanner modal */}
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
                  Point camera at barcode. Detected code will auto-fill the Barcode field.
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
              id="barcode-scanner-products"
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

      {/* Soft Delete confirm modal */}
      {confirmDelete && (
        <div style={overlayStyle} onMouseDown={() => (savingId ? null : setConfirmDelete(null))}>
          <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px" }}>Delete product?</h2>
            <p style={{ marginTop: 0, color: "#374151" }}>This will hide the product (soft delete):</p>

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
              <div style={{ color: "#6b7280" }}>SKU: {confirmDelete.sku || "-"}</div>
              <div style={{ color: "#6b7280" }}>Barcode: {confirmDelete.barcode || "-"}</div>
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
              <div style={{ marginTop: 10, color: "#991b1b", fontSize: 12 }}>{rowErrors[confirmDelete.id]}</div>
            ) : null}
          </div>
        </div>
      )}

      {/* Hard Delete confirm modal (OWNER only) */}
      {confirmHardDelete && (
        <div style={overlayStyle} onMouseDown={() => (savingId ? null : setConfirmHardDelete(null))}>
          <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 8px", color: "#991b1b" }}>Permanently delete?</h2>
            <p style={{ marginTop: 0, color: "#374151" }}>
              This is <b>permanent</b>. If the product has stock movement history, the server may block this.
            </p>

            <div
              style={{
                border: "1px solid #fecaca",
                borderRadius: 12,
                padding: 12,
                background: "#fff1f2",
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 800 }}>{confirmHardDelete.name}</div>
              <div style={{ color: "#6b7280" }}>SKU: {confirmHardDelete.sku || "-"}</div>
              <div style={{ color: "#6b7280" }}>Barcode: {confirmHardDelete.barcode || "-"}</div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={() => setConfirmHardDelete(null)} disabled={savingId != null}>
                Cancel
              </button>
              <button className="btn" onClick={confirmHardDeleteNow} disabled={savingId != null}>
                {savingId === confirmHardDelete.id ? "Deleting..." : "Yes, delete permanently"}
              </button>
            </div>

            {rowErrors[confirmHardDelete.id] ? (
              <div style={{ marginTop: 10, color: "#991b1b", fontSize: 12 }}>{rowErrors[confirmHardDelete.id]}</div>
            ) : null}
          </div>
        </div>
      )}

      <div className="products-tableWrap" style={{ marginTop: 14 }}>
        <table border="1" cellPadding="10" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#f3f4f6" }}>
            <tr>
              <th>Name</th>
              <th>SKU</th>
              <th>Barcode</th>
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
              const deleted = isDeleted(p);
              const isEditing = editingId === p.id;
              const isSaving = savingId === p.id;
              const inlineErr = rowErrors[p.id];

              const threshold = getThresholdForProduct(p, lowThreshold);
              const low = !deleted && viewMode === "active" ? isLowStock(p, lowThreshold) : false;

              return (
                <tr key={p.id} style={deleted ? { opacity: 0.75 } : undefined}>
                  <td>
                    {isEditing ? (
                      <input
                        className="input"
                        value={editForm?.name ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        disabled={isSaving}
                      />
                    ) : (
                      <>
                        {p.name}
                        {deleted && (
                          <span
                            style={{
                              marginLeft: 8,
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 900,
                              background: "#e5e7eb",
                              color: "#111827",
                              border: "1px solid #d1d5db",
                              verticalAlign: "middle",
                            }}
                            title={`Deleted at: ${p.deleted_at}`}
                          >
                            DELETED
                          </span>
                        )}
                        {low && (
                          <span
                            style={{
                              marginLeft: 8,
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 800,
                              background: "#fee2e2",
                              color: "#991b1b",
                              border: "1px solid #fecaca",
                              verticalAlign: "middle",
                            }}
                            title={`LOW: qty ${Number(p?.quantity ?? 0)} ≤ threshold ${threshold}`}
                          >
                            LOW
                          </span>
                        )}
                      </>
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
                      p.sku || "-"
                    )}
                  </td>

                  <td>
                    {isEditing ? (
                      <input
                        className="input"
                        value={editForm?.barcode ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, barcode: e.target.value }))}
                        disabled={isSaving}
                      />
                    ) : (
                      p.barcode || "-"
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

                  <td>
                    {isEditing ? (
                      <input
                        className="input"
                        type="number"
                        inputMode="numeric"
                        value={editForm?.quantity ?? ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))}
                        disabled={isSaving}
                      />
                    ) : (
                      p.quantity
                    )}
                  </td>

                  <td>{isEditing ? (
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      value={editForm?.cost_price ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, cost_price: e.target.value }))}
                      disabled={isSaving}
                    />
                  ) : (
                    p.cost_price
                  )}</td>

                  <td>{isEditing ? (
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      value={editForm?.selling_price ?? ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, selling_price: e.target.value }))}
                      disabled={isSaving}
                    />
                  ) : (
                    p.selling_price
                  )}</td>

                  <td>
                    {isEditing ? (
                      <input
                        className="input"
                        type="number"
                        inputMode="numeric"
                        value={editForm?.reorder_level ?? 0}
                        onChange={(e) => setEditForm((f) => ({ ...f, reorder_level: e.target.value }))}
                        disabled={isSaving}
                        placeholder={`0 = default ${lowThreshold}`}
                        title={`Set 0 to use tenant default (${lowThreshold})`}
                      />
                    ) : (
                      Number(p.reorder_level || 0) > 0 ? p.reorder_level : <span title={`Using default ${lowThreshold}`}>0*</span>
                    )}
                  </td>

                  {isAdmin && (
                    <td style={{ minWidth: 280 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        {/* Active rows (admin/owner) */}
                        {!deleted ? (
                          <>
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

                            <button className="btn" onClick={() => askDelete(p)} disabled={anyBusy || isEditing}>
                              Delete
                            </button>
                          </>
                        ) : (
                          <>
                            {/* Deleted rows */}
                            {isOwner && (
                              <>
                                <button className="btn" onClick={() => handleRestore(p)} disabled={anyBusy}>
                                  Restore
                                </button>
                                <button className="btn" onClick={() => askHardDelete(p)} disabled={anyBusy}>
                                  Delete permanently
                                </button>
                              </>
                            )}
                            {!isOwner && (
                              <span style={{ fontSize: 12, color: "#6b7280" }}>
                                Owner required to restore/delete permanently
                              </span>
                            )}
                          </>
                        )}
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
                <td colSpan={isAdmin ? 9 : 8} style={{ textAlign: "center" }}>
                  No products found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
          * Reorder “0” means “use tenant default threshold ({lowThreshold})”.
        </div>
      </div>
    </div>
  );
}
