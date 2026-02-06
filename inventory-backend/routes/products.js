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

// GET /api/products/by-sku/:sku (matches SKU OR barcode) — excludes deleted
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
        AND p.deleted_at IS NULL
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

// GET /api/products/by-code/:code (also matches SKU OR barcode) — excludes deleted
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
        AND p.deleted_at IS NULL
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
 * Supports:
 *  - ?search= (backward compatible)
 *  - ?q=
 *  - ?includeDeleted=true
 *  - ?onlyDeleted=true
 * ========================= */
// GET /api/products
router.get("/", async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const search = String(req.query.search || "").trim();

    const includeDeleted = String(req.query.includeDeleted || "").toLowerCase() === "true";
    const onlyDeleted = String(req.query.onlyDeleted || "").toLowerCase() === "true";

    const where = ["p.tenant_id = ?"];
    const params = [tenantId];

    // ✅ default excludes deleted
    if (!includeDeleted && !onlyDeleted) where.push("p.deleted_at IS NULL");
    if (onlyDeleted) where.push("p.deleted_at IS NOT NULL");

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
        p.created_at,
        p.updated_at,
        p.deleted_at,

        -- ✅ stock reconciliation fields:
        COALESCE(m.movement_balance, 0) AS movement_balance,
        (COALESCE(p.quantity,0) - COALESCE(m.movement_balance,0)) AS drift

      FROM products p
      LEFT JOIN categories c
        ON c.id = p.category_id AND c.tenant_id = p.tenant_id

      LEFT JOIN (
        SELECT
          tenant_id,
          product_id,
          SUM(CASE WHEN type='IN' THEN quantity ELSE -quantity END) AS movement_balance
        FROM stock_movements
        WHERE tenant_id = ?
        GROUP BY tenant_id, product_id
      ) m ON m.tenant_id = p.tenant_id AND m.product_id = p.id

      WHERE ${where.join(" AND ")}
      ORDER BY p.id DESC
      `,
      [tenantId, ...params]
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
 * NOTE: reorder_level default is 0 (means "use tenant default threshold")
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

  // ✅ default 0 => use tenant default threshold
  const reorder_level =
    req.body?.reorder_level === undefined || req.body?.reorder_level === null || req.body?.reorder_level === ""
      ? 0
      : Number(req.body.reorder_level);

  if (!name) return res.status(400).json({ message: "Product name is required." });
  if (!sku) return res.status(400).json({ message: "SKU is required." });

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
        Number.isFinite(reorder_level) ? reorder_level : 0,
      ]
    );

    await logAudit(req, {
      action: "PRODUCT_CREATE",
      entity_type: "product",
      entity_id: r.insertId,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: { name, sku, barcode, category_id, reorder_level: Number.isFinite(reorder_level) ? reorder_level : 0 },
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
 * (excludes deleted by default)
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
        AND p.deleted_at IS NULL
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

async function getTenantDriftSettings(tenantId) {
  const [[s]] = await db.query(
    `SELECT COALESCE(stock_drift_threshold, 5) AS stock_drift_threshold
     FROM settings
     WHERE tenant_id=? LIMIT 1`,
    [tenantId]
  );
  return { stock_drift_threshold: Number(s?.stock_drift_threshold || 5) };
}

async function computeMovementBalance(conn, tenantId, productId) {
  const [[r]] = await conn.query(
    `
    SELECT COALESCE(SUM(CASE WHEN type='IN' THEN quantity ELSE -quantity END),0) AS balance
    FROM stock_movements
    WHERE tenant_id=? AND product_id=?
    `,
    [tenantId, productId]
  );
  return Number(r?.balance || 0);
}

// POST /api/products/:id/reconcile  (admin/owner)
router.post("/:id/reconcile", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[p]] = await conn.query(
      `SELECT id, quantity, deleted_at FROM products WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE`,
      [tenantId, id]
    );
    if (!p) {
      await conn.rollback();
      return res.status(404).json({ message: "Product not found" });
    }
    if (p.deleted_at) {
      await conn.rollback();
      return res.status(400).json({ message: "Cannot reconcile a deleted product. Restore it first." });
    }

    const desiredQty = Number(p.quantity || 0);
    const movementBalance = await computeMovementBalance(conn, tenantId, id);

    const driftBefore = desiredQty - movementBalance;
    const absDrift = Math.abs(driftBefore);

    if (absDrift === 0) {
      await conn.commit();
      return res.json({ ok: true, driftBefore: 0, adjustment: 0, message: "No reconcile needed" });
    }

    const type = driftBefore > 0 ? "IN" : "OUT";
    const qty = absDrift;

    await conn.query(
      `
      INSERT INTO stock_movements (tenant_id, product_id, type, quantity, reason, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      `,
      [tenantId, id, type, qty, `Reconcile: movements -> match product.quantity (${desiredQty})`]
    );

    await logAudit(req, {
      action: "PRODUCT_STOCK_RECONCILE",
      entity_type: "product",
      entity_id: id,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: { driftBefore, adjustmentType: type, adjustmentQty: qty, desiredQty, movementBalance },
    });

    await conn.commit();

    return res.json({ ok: true, driftBefore, adjustment: driftBefore });
  } catch (e) {
    await conn.rollback();
    console.error("RECONCILE ERROR:", e);
    return res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});


/** =========================
 * ✅ Import rows endpoint used by your Products.jsx
 * POST /api/products/import-rows
 * (default reorder_level = 0)
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

      // ✅ blank => 0
      const reorder_level =
        r.reorder_level === undefined || r.reorder_level === null || r.reorder_level === ""
          ? 0
          : Number(r.reorder_level);

      try {
        // Upsert by (tenant_id, sku) — assumes UNIQUE(tenant_id, sku)
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
            reorder_level=VALUES(reorder_level),
            deleted_at=NULL
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
            Number.isFinite(reorder_level) ? reorder_level : 0,
          ]
        );

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

  const requestedQty =
    req.body?.quantity != null && Number.isFinite(Number(req.body.quantity))
      ? Number(req.body.quantity)
      : null;

  const cost_price = req.body?.cost_price != null ? Number(req.body.cost_price) : null;
  const selling_price = req.body?.selling_price != null ? Number(req.body.selling_price) : null;
  const reorder_level = req.body?.reorder_level != null ? Number(req.body.reorder_level) : null;

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [[product]] = await conn.query(
      `
      SELECT id, quantity
      FROM products
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
      FOR UPDATE
      `,
      [id, tenantId]
    );

    if (!product) {
      await conn.rollback();
      return res.status(404).json({ message: "Not found" });
    }

    const existingQty = Number(product.quantity || 0);

    await conn.query(
      `
      UPDATE products
      SET
        name = COALESCE(?, name),
        sku = COALESCE(?, sku),
        barcode = COALESCE(?, barcode),
        category_id = COALESCE(?, category_id),
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
        Number.isFinite(cost_price) ? cost_price : null,
        Number.isFinite(selling_price) ? selling_price : null,
        Number.isFinite(reorder_level) ? reorder_level : null,
        id,
        tenantId,
      ]
    );

    if (requestedQty !== null && requestedQty !== existingQty) {
      const diff = requestedQty - existingQty;
      const type = diff > 0 ? "IN" : "OUT";
      const absQty = Math.abs(diff);

      await conn.query(
        `UPDATE products SET quantity = ? WHERE id = ? AND tenant_id = ?`,
        [requestedQty, id, tenantId]
      );

      await conn.query(
        `
        INSERT INTO stock_movements
          (tenant_id, product_id, type, quantity, reason, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        `,
        [
          tenantId,
          id,
          type,
          absQty,
          `Manual adjustment (Products edit): set stock to ${requestedQty}`,
        ]
      );
    }

    // ✅ AUTO-RECONCILE: ensure movements sum matches products.quantity
    // (useful if legacy data drift exists)
    {
      const [[p2]] = await conn.query(
        `SELECT quantity, deleted_at FROM products WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE`,
        [tenantId, id]
      );

      if (!p2?.deleted_at) {
        const desiredQty = Number(p2.quantity || 0);
        const movementBalance = await computeMovementBalance(conn, tenantId, id);
        const drift = desiredQty - movementBalance;

        if (drift !== 0) {
          const type = drift > 0 ? "IN" : "OUT";
          const qty = Math.abs(drift);

          await conn.query(
            `
            INSERT INTO stock_movements (tenant_id, product_id, type, quantity, reason, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
            `,
            [tenantId, id, type, qty, `Auto-reconcile on product edit (qty=${desiredQty})`]
          );
        }
      }
    }


    await conn.commit();

    await logAudit(req, {
      action: "PRODUCT_UPDATE",
      entity_type: "product",
      entity_id: id,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: {
        id,
        updated_fields: Object.keys(req.body),
        quantity_changed: requestedQty !== null && requestedQty !== existingQty,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("PRODUCT UPDATE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});

/** =========================
 * DELETE /api/products/:id
 * owner/admin only
 * (SOFT delete)
 * ========================= */
router.delete("/:id", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  try {
    const [r] = await db.query(
      `
      UPDATE products
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
      `,
      [id, tenantId]
    );

    if (r.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "Product not found (or already deleted)" });
    }

    await logAudit(req, {
      action: "PRODUCT_DELETE_SOFT",
      entity_type: "product",
      entity_id: id,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: { id },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("PRODUCT DELETE ERROR:", e);
    return res.status(500).json({ ok: false, message: "Failed to delete product" });
  }
});

// DELETE /api/products/:id/hard  (HARD delete - owner only)
// Safer: only allow if there are NO stock movements (prevents FK issues)
router.delete("/:id/hard", requireRole("owner"), async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  try {
    const [[m]] = await db.query(
      `SELECT COUNT(*) AS c FROM stock_movements WHERE tenant_id=? AND product_id=?`,
      [tenantId, id]
    );

    if (Number(m?.c || 0) > 0) {
      return res.status(409).json({
        message:
          "Cannot permanently delete: product has stock movement history. Keep as deleted or delete movements first.",
      });
    }

    const [r] = await db.query(`DELETE FROM products WHERE id=? AND tenant_id=?`, [id, tenantId]);

    if (r.affectedRows === 0) return res.status(404).json({ message: "Product not found" });

    return res.json({ ok: true });
  } catch (e) {
    console.error("PRODUCT HARD DELETE ERROR:", e);
    return res.status(500).json({ message: "Database error" });
  }
});


/** =========================
 * PATCH /api/products/:id/restore
 * owner/admin only
 * ========================= */
router.patch("/:id/restore", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;
  const id = Number(req.params.id);

  try {
    const [r] = await db.query(
      `
      UPDATE products
      SET deleted_at = NULL, updated_at = NOW()
      WHERE id = ? AND tenant_id = ?
      `,
      [id, tenantId]
    );

    if (r.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "Product not found" });
    }

    await logAudit(req, {
      action: "PRODUCT_RESTORE",
      entity_type: "product",
      entity_id: id,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: { id },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("PRODUCT RESTORE ERROR:", e);
    return res.status(500).json({ ok: false, message: "Failed to restore product" });
  }
});

export default router;
