// routes/stock.js
import express from "express";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";

const router = express.Router();

// all stock routes require tenant-scoped token
router.use(requireAuth, requireTenant);

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function buildMovementFilters(req) {
  const from = String(req.query.from || "").trim(); // YYYY-MM-DD
  const to = String(req.query.to || "").trim(); // YYYY-MM-DD
  const type = String(req.query.type || "").trim().toUpperCase(); // IN/OUT
  const search = String(req.query.search || "").trim();

  const where = [];
  const params = [];

  if (type === "IN" || type === "OUT") {
    where.push("sm.type = ?");
    params.push(type);
  }

  if (from) {
    where.push("DATE(sm.created_at) >= ?");
    params.push(from);
  }
  if (to) {
    where.push("DATE(sm.created_at) <= ?");
    params.push(to);
  }

  if (search) {
    const like = `%${search}%`;
    where.push("(p.name LIKE ? OR p.sku LIKE ? OR sm.reason LIKE ?)");
    params.push(like, like, like);
  }

  return { where, params };
}

/**
 * GET /api/stock
 * Tenant-scoped list of products with quantity
 */
router.get("/", async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const [rows] = await db.query(
      `
      SELECT id, name, sku, category_id, barcode, quantity,
             cost_price, selling_price, reorder_level, created_at
      FROM products
      WHERE tenant_id = ?
      ORDER BY id DESC
      `,
      [tenantId]
    );

    res.json({ items: rows });
  } catch (err) {
    console.error("STOCK LIST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * ✅ Export stock movements CSV (owner/admin/staff)
 * Tenant-safe (filters sm.tenant_id)
 * Query params (optional):
 *  - search
 *  - type: IN | OUT
 *  - from: YYYY-MM-DD
 *  - to: YYYY-MM-DD
 */
router.get("/export.csv", requireRole("owner", "admin", "staff"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { where, params } = buildMovementFilters(req);

    // Always tenant scope FIRST
    const whereParts = ["sm.tenant_id = ?"];
    const allParams = [tenantId];

    if (where.length) {
      whereParts.push(...where);
      allParams.push(...params);
    }

    const sql = `
      SELECT
        sm.id,
        sm.type,
        p.name AS product_name,
        p.sku,
        sm.quantity,
        sm.reason,
        DATE_FORMAT(sm.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM stock_movements sm
      LEFT JOIN products p
        ON p.id = sm.product_id
       AND p.tenant_id = sm.tenant_id
      WHERE ${whereParts.join(" AND ")}
      ORDER BY sm.id DESC
    `;

    const [rows] = await db.query(sql, allParams);

    const header = ["id", "type", "product_name", "sku", "quantity", "reason", "created_at"];
    const lines = [header.join(",")];

    for (const r of rows) {
      lines.push(
        [
          csvEscape(r.id),
          csvEscape(r.type),
          csvEscape(r.product_name || ""),
          csvEscape(r.sku || ""),
          csvEscape(r.quantity ?? 0),
          csvEscape(r.reason || ""),
          csvEscape(r.created_at || ""),
        ].join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="stock_movements.csv"`);
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("STOCK CSV EXPORT ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * GET /api/stock/movements
 * Query params (optional):
 *  - limit (default 200, max 500)
 *  - productId (optional)
 *  - search (optional)
 *  - type (optional: IN/OUT)
 *  - from (optional: YYYY-MM-DD)
 *  - to (optional: YYYY-MM-DD)
 */
// GET /api/stock/movements
// Supports optional filters: search, type, from, to, limit, productId
// routes/stock.js
router.get("/movements", async (req, res) => {
  try {
    const tenantId = req.tenantId; // ✅ you already have requireTenant middleware
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const type = String(req.query.type || "").trim().toUpperCase();
    const search = String(req.query.search || "").trim();

    const where = ["sm.tenant_id = ?"];
    const params = [tenantId];

    if (type === "IN" || type === "OUT") {
      where.push("sm.type = ?");
      params.push(type);
    }

    if (from) {
      where.push("DATE(sm.created_at) >= ?");
      params.push(from);
    }
    if (to) {
      where.push("DATE(sm.created_at) <= ?");
      params.push(to);
    }

    if (search) {
      const like = `%${search}%`;
      where.push("(p.name LIKE ? OR p.sku LIKE ? OR sm.reason LIKE ?)");
      params.push(like, like, like);
    }

    const sql = `
      SELECT
        sm.id,
        sm.product_id,
        p.name AS product_name,
        p.sku,
        sm.type,
        sm.quantity,
        sm.reason,
        sm.created_at
      FROM stock_movements sm
      LEFT JOIN products p
        ON p.id = sm.product_id
       AND p.tenant_id = sm.tenant_id
      WHERE ${where.join(" AND ")}
      ORDER BY sm.id DESC
      LIMIT ?
    `;

    params.push(limit);

    const [rows] = await db.query(sql, params);
    res.json({ movements: rows || [] });
  } catch (e) {
    console.error("STOCK MOVEMENTS ERROR:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
});


/**
 * POST /api/stock/move
 * Body: { productId, type: 'IN'|'OUT', quantity, reason }
 * Adjusts products.quantity and logs stock_movements (tenant-scoped)
 */
router.post("/move", requireRole("owner", "admin", "staff"), async (req, res) => {
  const tenantId = req.tenantId;
  const userId = req.user.id;

  const productId = Number(req.body?.productId);
  const type = String(req.body?.type || "").toUpperCase();
  const qty = Number(req.body?.quantity);
  const reason = String(req.body?.reason || "").trim();

  if (!productId) return res.status(400).json({ message: "productId required" });
  if (!["IN", "OUT"].includes(type)) return res.status(400).json({ message: "type must be IN or OUT" });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: "quantity must be > 0" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [pRows] = await conn.query(
      `
      SELECT id, quantity
      FROM products
      WHERE id = ? AND tenant_id = ?
      FOR UPDATE
      `,
      [productId, tenantId]
    );

    if (!pRows.length) {
      await conn.rollback();
      return res.status(404).json({ message: "Product not found" });
    }

    const currentQty = Number(pRows[0].quantity || 0);
    const newQty = type === "IN" ? currentQty + qty : currentQty - qty;

    if (newQty < 0) {
      await conn.rollback();
      return res.status(400).json({ message: "Insufficient stock" });
    }

    await conn.query(
      `UPDATE products SET quantity = ? WHERE id = ? AND tenant_id = ?`,
      [newQty, productId, tenantId]
    );

    const [mr] = await conn.query(
      `
      INSERT INTO stock_movements (tenant_id, product_id, type, quantity, reason, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      `,
      [tenantId, productId, type, qty, reason || null]
    );

    await conn.commit();

    // Audit AFTER commit (safer: avoids writing audit row if transaction rolls back)
   await logAudit(req, {
      action: "STOCK_MOVE",
      entity_type: "product",
      entity_id: productId,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: {
        type,
        qty,
        reason,
        from: currentQty,
        to: newQty,
        movement_id: mr.insertId,
      },
    });


    res.status(201).json({ ok: true, movementId: mr.insertId, quantity: newQty });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    console.error("STOCK MOVE ERROR:", e);
    res.status(500).json({ message: "Server error" });
  } finally {
    conn.release();
  }
});

export default router;
