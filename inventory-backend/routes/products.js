import express from "express";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ✅ any logged in user can view products
router.get("/", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.category_id,
        c.name AS category,
        p.quantity,
        p.cost_price,
        p.selling_price,
        p.reorder_level,
        p.created_at
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

// ✅ admin only can create product
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const {
      name,
      sku,
      category_id = null,
      quantity = 0,
      cost_price = 0,
      selling_price = 0,
      reorder_level = 10,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
    if (!sku?.trim()) return res.status(400).json({ message: "SKU is required" });

    const cid = category_id ? Number(category_id) : null;

    const [result] = await db.query(
      `INSERT INTO products
        (name, sku, category_id, quantity, cost_price, selling_price, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        sku.trim(),
        cid,
        Number(quantity) || 0,
        Number(cost_price) || 0,
        Number(selling_price) || 0,
        Number(reorder_level) || 0,
      ]
    );

    await logAudit(req, {
      action: "PRODUCT_CREATE",
      entity: "product",
      entity_id: result.insertId,
      metadata: {
        name: name.trim(),
        sku: sku.trim(),
        category_id: cid,
        quantity: Number(quantity) || 0,
        cost_price: Number(cost_price) || 0,
        selling_price: Number(selling_price) || 0,
        reorder_level: Number(reorder_level) || 0,
      },
    });

    res.json({ message: "Product created", id: result.insertId });
  } catch (err) {
    console.error("PRODUCTS POST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
