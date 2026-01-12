import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";


const router = express.Router();

// Get latest movements
router.get("/movements", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT sm.id, sm.product_id, p.name AS product_name, sm.type, sm.quantity, sm.reason, sm.created_at
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       ORDER BY sm.id DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error("MOVEMENTS GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// Stock IN / OUT
router.post("/update", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { product_id, type, quantity, reason = "" } = req.body;

    const pid = Number(product_id);
    const qty = Number(quantity);

    if (!pid || !["IN", "OUT"].includes(type) || !qty || qty <= 0) {
      return res.status(400).json({ message: "Invalid input" });
    }

    await connection.beginTransaction();

    // Get current stock
    const [[product]] = await connection.query(
      "SELECT quantity FROM products WHERE id=? FOR UPDATE",
      [pid]
    );

    if (!product) {
      await connection.rollback();
      return res.status(404).json({ message: "Product not found" });
    }

    const currentQty = Number(product.quantity);
    const newQty = type === "IN" ? currentQty + qty : currentQty - qty;

    if (newQty < 0) {
      await connection.rollback();
      return res.status(400).json({ message: "Not enough stock to stock out" });
    }

    // Update product quantity
    await connection.query("UPDATE products SET quantity=? WHERE id=?", [newQty, pid]);

    // Insert movement record
    await connection.query(
      "INSERT INTO stock_movements (product_id, type, quantity, reason) VALUES (?,?,?,?)",
      [pid, type, qty, reason]
    );

    await connection.commit();

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
