// routes/stock.js
import express from "express";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

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

  // type filter (only if valid)
  if (type === "IN" || type === "OUT") {
    where.push("sm.type = ?");
    params.push(type);
  }

  // date filters (only if provided)
  if (from) {
    where.push("DATE(sm.created_at) >= ?");
    params.push(from);
  }
  if (to) {
    where.push("DATE(sm.created_at) <= ?");
    params.push(to);
  }

  // search filter (only if provided)
  if (search) {
    const like = `%${search}%`;
    where.push("(p.name LIKE ? OR p.sku LIKE ? OR sm.reason LIKE ?)");
    params.push(like, like, like);
  }

  return { where, params, from, to, type, search };
}

/**
 * ✅ Export stock movements CSV (admin + staff)
 * Query params (optional):
 *  - search
 *  - type: IN | OUT
 *  - from: YYYY-MM-DD
 *  - to: YYYY-MM-DD
 */
router.get("/export.csv", requireAuth, requireRole("admin", "staff"), async (req, res) => {
  try {
    const { where, params } = buildMovementFilters(req);

    const sql = `
      SELECT
        sm.id,
        sm.type,
        p.name AS product_name,
        p.sku,
        sm.quantity,
        sm.reason,
        sm.created_at
      FROM stock_movements sm
      LEFT JOIN products p ON p.id = sm.product_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY sm.id DESC
    `;

    const [rows] = await db.query(sql, params);

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
 * ✅ movements (any logged in user)
 * Supports same filters as export:
 *  - search, type, from, to
 * Plus:
 *  - limit (default 200, max 2000)
 */
router.get("/movements", requireAuth, async (req, res) => {
  try {
    const { where, params } = buildMovementFilters(req);

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 2000) : 200;

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
      JOIN products p ON p.id = sm.product_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY sm.id DESC
      LIMIT ?
    `;

    const [rows] = await db.query(sql, [...params, limit]);
    res.json(rows);
  } catch (err) {
    console.error("MOVEMENTS GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ stock update (admin only)
router.post("/update", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { product_id, type, quantity, reason = "" } = req.body;

    const pid = Number(product_id);
    const qty = Number(quantity);

    if (!pid || !["IN", "OUT"].includes(type) || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ message: "Invalid input" });
    }

    await connection.beginTransaction();

    const [[product]] = await connection.query(
      "SELECT id, name, quantity FROM products WHERE id=? FOR UPDATE",
      [pid]
    );

    if (!product) {
      await connection.rollback();
      return res.status(404).json({ message: "Product not found" });
    }

    const oldQty = Number(product.quantity ?? 0);
    const newQty = type === "IN" ? oldQty + qty : oldQty - qty;

    if (newQty < 0) {
      await connection.rollback();
      return res.status(400).json({ message: "Not enough stock to stock out" });
    }

    await connection.query("UPDATE products SET quantity=? WHERE id=?", [newQty, pid]);

    await connection.query(
      "INSERT INTO stock_movements (product_id, type, quantity, reason) VALUES (?,?,?,?)",
      [pid, type, qty, String(reason || "").trim()]
    );

    await connection.commit();

    await logAudit(req, {
      action: type === "IN" ? "STOCK_IN" : "STOCK_OUT",
      entity_type: "product",
      entity_id: pid,
      details: { product_name: product.name, qty, reason: String(reason || "").trim(), oldQty, newQty },
    });

    res.json({ message: "Stock updated", newQty });
  } catch (err) {
    await connection.rollback();
    console.error("STOCK UPDATE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  } finally {
    connection.release();
  }
});

export default router;
