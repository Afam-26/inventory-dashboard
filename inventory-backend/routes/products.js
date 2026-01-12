import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ✅ GET products (any logged in user)
router.get("/", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        p.id,
        p.name,
        p.sku,
        p.category_id,
        p.quantity,
        p.cost_price,
        p.selling_price,
        p.reorder_level,
        c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.id DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("PRODUCTS GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ POST product (admin only)
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const {
      name,
      sku,
      category_id,
      quantity = 0,
      cost_price = 0,
      selling_price = 0,
      reorder_level = 10,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
    if (!sku?.trim()) return res.status(400).json({ message: "SKU is required" });

    const cid = category_id ? Number(category_id) : null;

    const qty = Number(quantity);
    const cost = Number(cost_price);
    const sell = Number(selling_price);
    const reorder = Number(reorder_level);

    if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ message: "Invalid quantity" });
    if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ message: "Invalid cost price" });
    if (!Number.isFinite(sell) || sell < 0) return res.status(400).json({ message: "Invalid selling price" });
    if (!Number.isFinite(reorder) || reorder < 0) return res.status(400).json({ message: "Invalid reorder level" });

    const [result] = await db.query(
      `INSERT INTO products (name, sku, category_id, quantity, cost_price, selling_price, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), sku.trim(), cid, qty, cost, sell, reorder]
    );

    res.json({ message: "Product created", id: result.insertId });
  } catch (err) {
    console.error("PRODUCTS POST ERROR:", err);

    // helpful error if SKU unique constraint exists
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "SKU already exists" });
    }

    res.status(500).json({ message: "Database error" });
  }
});

export default router;
