import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";


const router = express.Router();

// GET all products (include category name)
router.get("/", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.name, p.sku, p.quantity, p.cost_price, p.selling_price, p.reorder_level,
              p.created_at,
              c.name AS category
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ORDER BY p.id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("PRODUCTS GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// POST create product
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

    if (!name?.trim() || !sku?.trim()) {
      return res.status(400).json({ message: "Name and SKU are required" });
    }

    await db.query(
      `INSERT INTO products
       (name, sku, category_id, quantity, cost_price, selling_price, reorder_level)
       VALUES (?,?,?,?,?,?,?)`,
      [
        name.trim(),
        sku.trim(),
        category_id ? Number(category_id) : null,
        Number(quantity),
        Number(cost_price),
        Number(selling_price),
        Number(reorder_level),
      ]
    );

    res.json({ message: "Product created" });
  } catch (err) {
    console.error("PRODUCTS POST ERROR:", err);

    // Friendly message for duplicate SKU
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "SKU already exists" });
    }

    res.status(500).json({ message: "Database error" });
  }
});

export default router;
