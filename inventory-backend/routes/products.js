// routes/products.js
import express from "express";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";

const router = express.Router();

// All product routes require tenant scope
router.use(requireAuth, requireTenant);

/** =========================
 * CSV helpers
 * ========================= */
function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

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

/** =========================
 * ✅ IMPORTANT: SCAN ROUTES FIRST
 * These MUST come before "/:id" routes
 * ========================= */

// GET /api/products/by-sku/:sku (matches SKU OR barcode)
router.get("/by-sku/:sku", requireRole("owner", "admin", "staff"), async (req, res) => {
  const tenantId = req.tenantId;
  const code = String(req.params.sku || "").trim();
  if (!code) return res.status(400).json({ message: "SKU is required" });

  try {
    const [[p]] = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.barcode,
        p.category_id,
        c.name AS category,
        p.quantity,
        p.cost_price,
        p.selling_price,
        p.reorder_level,
        p.created_at
      FROM products p
      LEFT JOIN categories c
        ON c.id = p.category_id AND c.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
        AND (p.sku = ? OR p.barcode = ?)
      LIMIT 1
      `,
      [tenantId, code, code]
    );

    if (!p) return res.status(404).json({ message: "Product not found" });
    return res.json(p);
  } catch (err) {
    console.error("PRODUCT BY SKU/BARCODE ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

// GET /api/products/by-code/:code (also matches SKU OR barcode)
router.get("/by-code/:code", requireRole("owner", "admin", "staff"), async (req, res) => {
  const tenantId = req.tenantId;
  const code = String(req.params.code || "").trim();
  if (!code) return res.status(400).json({ message: "Code is required" });

  try {
    const [[p]] = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.barcode,
        p.category_id,
        c.name AS category,
        p.quantity,
        p.cost_price,
        p.selling_price,
        p.reorder_level,
        p.created_at
      FROM products p
      LEFT JOIN categories c
        ON c.id = p.category_id AND c.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
        AND (p.sku = ? OR p.barcode = ?)
      LIMIT 1
      `,
      [tenantId, code, code]
    );

    if (!p) return res.status(404).json({ message: "Product not found for scanned code" });
    return res.json(p);
  } catch (err) {
    console.error("PRODUCT BY CODE ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

/** =========================
 * GET /api/products
 * Tenant-scoped list + optional search
 * Supports: ?search=
 * ========================= */
router.get("/", async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const search = String(req.query.search || "").trim();
    const where = ["p.tenant_id = ?"];
    const params = [tenantId];

    if (search) {
      const like = `%${search}%`;
      where.push("(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR c.name LIKE ?)");
      params.push(like, like, like, like);
    }

    const [rows] = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.barcode,
        p.category_id,
        c.name AS category,
        p.quantity,
        p.cost_price,
        p.selling_price,
        p.reorder_level,
        p.created_at
      FROM products p
      LEFT JOIN categories c
        ON c.id = p.category_id AND c.tenant_id = p.tenant_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.id DESC
      `,
      params
    );

    return res.json({ products: rows || [] });
  } catch (err) {
    console.error("PRODUCTS LIST ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

/** =========================
 * POST /api/products
 * owner/admin only
 * Body: { name, sku, barcode, category_id, quantity, cost_price, selling_price, reorder_level }
 * ========================= */
router.post("/", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;

  const name = String(req.body?.name ?? "").trim();
  const sku = String(req.body?.sku ?? "").trim() || null;
  const barcode = String(req.body?.barcode ?? "").trim() || null;

  const category_id = req.body?.category_id ? Number(req.body.category_id) : null;

  const quantity = Number(req.body?.quantity);
  const cost_price = Number(req.body?.cost_price);
  const selling_price = Number(req.body?.selling_price);
  const reorder_level =
    req.body?.reorder_level === undefined || req.body?.reorder_level === null || req.body?.reorder_level === ""
      ? 10
      : Number(req.body.reorder_level);

  if (!name) return res.status(400).json({ message: "Name required" });

  try {
    // If category_id is provided, ensure it belongs to tenant
    if (category_id) {
      const [[cat]] = await db.query(`SELECT id FROM categories WHERE id=? AND tenant_id=? LIMIT 1`, [
        category_id,
        tenantId,
      ]);
      if (!cat) return res.status(400).json({ message: "Invalid category_id" });
    }

    const [r] = await db.query(
      `
      INSERT INTO products
        (tenant_id, name, sku, barcode, category_id, quantity, cost_price, selling_price, reorder_level)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        tenantId,
        name,
        sku,
        barcode,
        category_id,
        Number.isFinite(quantity) ? quantity : 0,
        Number.isFinite(cost_price) ? cost_price : 0,
        Number.isFinite(selling_price) ? selling_price : 0,
        Number.isFinite(reorder_level) ? reorder_level : 10,
      ]
    );

    await logAudit(req, {
      action: "PRODUCT_CREATE",
      entity_type: "product",
      entity_id: r.insertId,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: { name, sku, barcode, category_id },
    });

    return res.status(201).json({ id: r.insertId });
  } catch (err) {
    console.error("PRODUCT CREATE ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

/** =========================
 * ✅ CSV export (owner/admin/staff) - tenant scoped
 * GET /api/products/export.csv
 * ========================= */
router.get("/export.csv", requireRole("owner", "admin", "staff"), async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const [rows] = await db.query(
      `
      SELECT
        p.name,
        p.sku,
        p.barcode,
        c.name AS category,
        p.quantity,
        p.cost_price,
        p.selling_price,
        p.reorder_level
      FROM products p
      LEFT JOIN categories c
        ON c.id = p.category_id AND c.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
      ORDER BY p.id DESC
      `,
      [tenantId]
    );

    const header = ["name", "sku", "barcode", "category", "quantity", "cost_price", "selling_price", "reorder_level"];
    const lines = [header.join(",")];

    for (const r of rows || []) {
      lines.push(
        [
          csvEscape(r.name),
          csvEscape(r.sku || ""),
          csvEscape(r.barcode || ""),
          csvEscape(r.category || ""),
          csvEscape(r.quantity ?? 0),
          csvEscape(r.cost_price ?? 0),
          csvEscape(r.selling_price ?? 0),
          csvEscape(r.reorder_level ?? 0),
        ].join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="products.csv"`);
    return res.send(lines.join("\n"));
  } catch (err) {
    console.error("PRODUCTS CSV EXPORT ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

/** =========================
 * ✅ Import rows endpoint used by your Products.jsx
 * POST /api/products/import-rows
 * Body: { rows: [{ name, sku, barcode, category, quantity, cost_price, selling_price, reorder_level }], createMissingCategories }
 * ========================= */
router.post("/import-rows", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const createMissingCategories = req.body?.createMissingCategories !== false;

    if (!rows.length) {
      return res.status(400).json({ message: "rows is required" });
    }

    // cache categories per tenant
    const catCache = new Map();

    async function getCategoryIdByName(nameRaw) {
      const name = String(nameRaw || "").trim();
      if (!name) return null;

      const key = name.toLowerCase();
      if (catCache.has(key)) return catCache.get(key);

      const [[found]] = await db.query(
        "SELECT id FROM categories WHERE tenant_id=? AND LOWER(name)=LOWER(?) AND deleted_at IS NULL LIMIT 1",
        [tenantId, name]
      );

      if (found?.id) {
        catCache.set(key, found.id);
        return found.id;
      }

      if (!createMissingCategories) return null;

      const [r] = await db.query("INSERT INTO categories (tenant_id, name) VALUES (?, ?)", [tenantId, name]);
      const newId = r.insertId;

      await logAudit(req, {
        action: "CATEGORY_CREATE",
        entity_type: "category",
        entity_id: newId,
        user_id: req.user?.id ?? null,
        user_email: req.user?.email ?? null,
        details: { name, via: "IMPORT_ROWS" },
      });

      catCache.set(key, newId);
      return newId;
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const name = String(r.name || "").trim();
      const sku = String(r.sku || "").trim();
      const barcode = String(r.barcode || "").trim() || null;

      if (!name || !sku) {
        skipped++;
        errors.push({ index: i, sku: sku || "", message: "Missing required: name or sku" });
        continue;
      }

      // category by name (optional)
      const categoryName = String(r.category || "").trim();
      const category_id = categoryName ? await getCategoryIdByName(categoryName) : null;

      const quantity = Number(r.quantity);
      const cost_price = Number(r.cost_price);
      const selling_price = Number(r.selling_price);
      const reorder_level =
        r.reorder_level === undefined || r.reorder_level === null || r.reorder_level === ""
          ? 10
          : Number(r.reorder_level);

      try {
        // Upsert by (tenant_id, sku) — assumes you have UNIQUE(tenant_id, sku)
        const [result] = await db.query(
          `
          INSERT INTO products
            (tenant_id, name, sku, barcode, category_id, quantity, cost_price, selling_price, reorder_level)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            name=VALUES(name),
            barcode=VALUES(barcode),
            category_id=VALUES(category_id),
            quantity=VALUES(quantity),
            cost_price=VALUES(cost_price),
            selling_price=VALUES(selling_price),
            reorder_level=VALUES(reorder_level)
          `,
          [
            tenantId,
            name,
            sku,
            barcode,
            category_id,
            Number.isFinite(quantity) ? quantity : 0,
            Number.isFinite(cost_price) ? cost_price : 0,
            Number.isFinite(selling_price) ? selling_price : 0,
            Number.isFinite(reorder_level) ? reorder_level : 10,
          ]
        );

        // mysql2 affectedRows: 1 insert, 2 update
        if (result.affectedRows === 1) inserted++;
        else if (result.affectedRows === 2) updated++;
        else skipped++;
      } catch (e) {
        skipped++;
        errors.push({ index: i, sku, message: e?.message || "DB error" });
      }
    }

    await logAudit(req, {
      action: "PRODUCTS_IMPORT_ROWS",
      entity_type: "product",
      entity_id: null,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: { inserted, updated, skipped, errorsCount: errors.length },
    });

    return res.json({ inserted, updated, skipped, errors });
  } catch (err) {
    console.error("PRODUCTS IMPORT-ROWS ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

/** =========================
 * CSV import (admin only) - tenant scoped + upsert by (tenant_id, sku)
 * POST /api/products/import
 * Body: { csvText }
 * ========================= */
router.post("/import", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const csvText = String(req.body?.csvText || "");
    if (!csvText.trim()) return res.status(400).json({ message: "csvText is required" });

    const rows = parseCsv(csvText);
    if (rows.length < 2) return res.status(400).json({ message: "CSV must include header and at least 1 row" });

    const header = rows[0].map((h) => String(h || "").trim().toLowerCase());
    const idx = (name) => header.indexOf(name);

    const required = ["name", "sku"];
    for (const r of required) {
      if (idx(r) === -1) return res.status(400).json({ message: `Missing required column: ${r}` });
    }

    const iName = idx("name");
    const iSku = idx("sku");
    const iBarcode = idx("barcode");
    const iCategory = idx("category");
    const iQuantity = idx("quantity");
    const iCost = idx("cost_price");
    const iSell = idx("selling_price");
    const iReorder = idx("reorder_level");

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    const catCache = new Map();

    async function getOrCreateCategoryId(catNameRaw) {
      const catName = String(catNameRaw || "").trim();
      if (!catName) return null;

      const key = catName.toLowerCase();
      if (catCache.has(key)) return catCache.get(key);

      const [[found]] = await db.query(
        "SELECT id FROM categories WHERE tenant_id=? AND LOWER(name)=LOWER(?) AND deleted_at IS NULL LIMIT 1",
        [tenantId, catName]
      );

      if (found?.id) {
        catCache.set(key, found.id);
        return found.id;
      }

      const [r] = await db.query("INSERT INTO categories (tenant_id, name) VALUES (?, ?)", [tenantId, catName]);
      const newId = r.insertId;

      await logAudit(req, {
        action: "CATEGORY_CREATE",
        entity_type: "category",
        entity_id: newId,
        details: { name: catName, via: "CSV_IMPORT" },
        user_id: req.user?.id ?? null,
        user_email: req.user?.email ?? null,
      });

      catCache.set(key, newId);
      return newId;
    }

    for (let line = 1; line < rows.length; line++) {
      const r = rows[line];

      const name = String(r[iName] ?? "").trim();
      const sku = String(r[iSku] ?? "").trim();

      if (!name || !sku) {
        skipped++;
        errors.push({ line: line + 1, message: "Missing name or sku" });
        continue;
      }

      const barcode = iBarcode !== -1 ? String(r[iBarcode] ?? "").trim() : "";
      const categoryName = iCategory !== -1 ? String(r[iCategory] ?? "").trim() : "";
      const category_id = categoryName ? await getOrCreateCategoryId(categoryName) : null;

      const quantity = iQuantity !== -1 ? Number(r[iQuantity]) || 0 : 0;
      const cost_price = iCost !== -1 ? Number(r[iCost]) || 0 : 0;
      const selling_price = iSell !== -1 ? Number(r[iSell]) || 0 : 0;
      const reorder_level = iReorder !== -1 ? Number(r[iReorder]) || 10 : 10;

      const [result] = await db.query(
        `
        INSERT INTO products
          (tenant_id, name, sku, barcode, category_id, quantity, cost_price, selling_price, reorder_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name=VALUES(name),
          barcode=VALUES(barcode),
          category_id=VALUES(category_id),
          quantity=VALUES(quantity),
          cost_price=VALUES(cost_price),
          selling_price=VALUES(selling_price),
          reorder_level=VALUES(reorder_level)
        `,
        [tenantId, name, sku, barcode || null, category_id, quantity, cost_price, selling_price, reorder_level]
      );

      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows === 2) updated++;
      else skipped++;
    }

    await logAudit(req, {
      action: "PRODUCTS_CSV_IMPORT",
      entity_type: "product",
      entity_id: null,
      details: { inserted, updated, skipped, errorsCount: errors.length },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
    });

    return res.json({ message: "CSV import completed", inserted, updated, skipped, errors });
  } catch (err) {
    console.error("PRODUCTS CSV IMPORT ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

/** =========================
 * PUT /api/products/:id
 * owner/admin only
 * ========================= */
router.put("/:id", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  const name = req.body?.name != null ? String(req.body.name).trim() : null;
  const sku = req.body?.sku != null ? String(req.body.sku).trim() : null;
  const barcode = req.body?.barcode != null ? String(req.body.barcode).trim() : null;

  const category_id = req.body?.category_id != null ? Number(req.body.category_id) : null;

  const quantity = req.body?.quantity != null ? Number(req.body.quantity) : null;
  const cost_price = req.body?.cost_price != null ? Number(req.body.cost_price) : null;
  const selling_price = req.body?.selling_price != null ? Number(req.body.selling_price) : null;
  const reorder_level = req.body?.reorder_level != null ? Number(req.body.reorder_level) : null;

  try {
    if (!id) return res.status(400).json({ message: "Invalid id" });

    if (category_id) {
      const [[cat]] = await db.query(`SELECT id FROM categories WHERE id=? AND tenant_id=? LIMIT 1`, [
        category_id,
        tenantId,
      ]);
      if (!cat) return res.status(400).json({ message: "Invalid category_id" });
    }

    const [r] = await db.query(
      `
      UPDATE products
      SET
        name = COALESCE(?, name),
        sku = COALESCE(?, sku),
        barcode = COALESCE(?, barcode),
        category_id = COALESCE(?, category_id),
        quantity = COALESCE(?, quantity),
        cost_price = COALESCE(?, cost_price),
        selling_price = COALESCE(?, selling_price),
        reorder_level = COALESCE(?, reorder_level)
      WHERE id = ? AND tenant_id = ?
      `,
      [
        name,
        sku,
        barcode,
        category_id,
        Number.isFinite(quantity) ? quantity : null,
        Number.isFinite(cost_price) ? cost_price : null,
        Number.isFinite(selling_price) ? selling_price : null,
        Number.isFinite(reorder_level) ? reorder_level : null,
        id,
        tenantId,
      ]
    );

    if (r.affectedRows === 0) return res.status(404).json({ message: "Not found" });

    await logAudit(req, {
      action: "PRODUCT_UPDATE",
      entity_type: "product",
      entity_id: id,
      details: { id, changes: req.body },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("PRODUCT UPDATE ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

/** =========================
 * DELETE /api/products/:id
 * owner only
 * ========================= */
router.delete("/:id", requireRole("owner"), async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  try {
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const [r] = await db.query(`DELETE FROM products WHERE id = ? AND tenant_id = ?`, [id, tenantId]);

    if (r.affectedRows === 0) return res.status(404).json({ message: "Not found" });

    await logAudit(req, {
      action: "PRODUCT_DELETE",
      entity_type: "product",
      entity_id: id,
      details: { id },
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("PRODUCT DELETE ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

export default router;
