// routes/products.js
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

    const cleanName = String(name || "").trim();
    const cleanSku = String(sku || "").trim();

    if (!cleanName) return res.status(400).json({ message: "Name is required" });
    if (!cleanSku) return res.status(400).json({ message: "SKU is required" });

    // ✅ prevent duplicate SKU
    const [[skuExists]] = await db.query("SELECT id FROM products WHERE sku=? LIMIT 1", [cleanSku]);
    if (skuExists) return res.status(409).json({ message: "SKU already exists" });

    const cid = category_id ? Number(category_id) : null;

    const [result] = await db.query(
      `INSERT INTO products
        (name, sku, category_id, quantity, cost_price, selling_price, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanName,
        cleanSku,
        cid,
        Number(quantity) || 0,
        Number(cost_price) || 0,
        Number(selling_price) || 0,
        Number(reorder_level) || 0,
      ]
    );

    await logAudit(req, {
      action: "PRODUCT_CREATE",
      entity_type: "product",
      entity_id: result.insertId,
      details: {
        name: cleanName,
        sku: cleanSku,
        category_id: cid,
        quantity: Number(quantity) || 0,
        cost_price: Number(cost_price) || 0,
        selling_price: Number(selling_price) || 0,
        reorder_level: Number(reorder_level) || 0,
      },
    });

    // return created row
    const [[created]] = await db.query(
      `SELECT p.id, p.name, p.sku, p.category_id, c.name AS category,
              p.quantity, p.cost_price, p.selling_price, p.reorder_level, p.created_at
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id=? LIMIT 1`,
      [result.insertId]
    );

    res.json({ message: "Product created", id: result.insertId, product: created });
  } catch (err) {
    console.error("PRODUCTS POST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ admin only: edit product
router.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid product id" });

    // fetch current
    const [[current]] = await db.query("SELECT * FROM products WHERE id=? LIMIT 1", [id]);
    if (!current) return res.status(404).json({ message: "Product not found" });

    const name = req.body?.name != null ? String(req.body.name).trim() : current.name;
    const sku = req.body?.sku != null ? String(req.body.sku).trim() : current.sku;

    const category_id =
      req.body?.category_id !== undefined
        ? req.body.category_id === null || req.body.category_id === ""
          ? null
          : Number(req.body.category_id)
        : current.category_id;

    const cost_price =
      req.body?.cost_price !== undefined ? Number(req.body.cost_price) || 0 : current.cost_price;

    const selling_price =
      req.body?.selling_price !== undefined
        ? Number(req.body.selling_price) || 0
        : current.selling_price;

    const reorder_level =
      req.body?.reorder_level !== undefined
        ? Number(req.body.reorder_level) || 0
        : current.reorder_level;

    if (!name) return res.status(400).json({ message: "Name is required" });
    if (!sku) return res.status(400).json({ message: "SKU is required" });

    // ✅ prevent duplicate SKU (but allow if it's the same product)
    if (sku !== current.sku) {
      const [[skuExists]] = await db.query(
        "SELECT id FROM products WHERE sku=? AND id<>? LIMIT 1",
        [sku, id]
      );
      if (skuExists) return res.status(409).json({ message: "SKU already exists" });
    }

    await db.query(
      `UPDATE products
       SET name=?, sku=?, category_id=?, cost_price=?, selling_price=?, reorder_level=?
       WHERE id=?`,
      [name, sku, category_id, cost_price, selling_price, reorder_level, id]
    );

    await logAudit(req, {
      action: "PRODUCT_UPDATE",
      entity_type: "product",
      entity_id: id,
      details: {
        old: {
          name: current.name,
          sku: current.sku,
          category_id: current.category_id,
          cost_price: current.cost_price,
          selling_price: current.selling_price,
          reorder_level: current.reorder_level,
        },
        new: { name, sku, category_id, cost_price, selling_price, reorder_level },
      },
    });

    const [[updated]] = await db.query(
      `SELECT p.id, p.name, p.sku, p.category_id, c.name AS category,
              p.quantity, p.cost_price, p.selling_price, p.reorder_level, p.created_at
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id=? LIMIT 1`,
      [id]
    );

    res.json({ message: "Product updated", product: updated });
  } catch (err) {
    console.error("PRODUCT PATCH ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ admin only: delete product
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid product id" });

    const [[current]] = await db.query(
      "SELECT id, name, sku, category_id FROM products WHERE id=? LIMIT 1",
      [id]
    );
    if (!current) return res.status(404).json({ message: "Product not found" });

    await db.query("DELETE FROM products WHERE id=?", [id]);

    await logAudit(req, {
      action: "PRODUCT_DELETE",
      entity_type: "product",
      entity_id: id,
      details: { deleted: current },
    });

    res.json({ message: "Product deleted", deleted: current });
  } catch (err) {
    console.error("PRODUCT DELETE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
