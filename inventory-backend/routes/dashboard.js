import express from "express";
import { db } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    // 1) total products
    const [[totalRow]] = await db.query(
      `SELECT COUNT(*) AS totalProducts FROM products`
    );

    // 2) low stock count
    const [[lowRow]] = await db.query(
      `SELECT COUNT(*) AS lowStockCount
       FROM products
       WHERE COALESCE(quantity, 0) <= COALESCE(reorder_level, 0)`
    );

    // 3) inventory value (choose cost_price or selling_price)
    const [[valueRow]] = await db.query(
      `SELECT COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(cost_price, 0)), 0) AS inventoryValue
       FROM products`
      // If you want selling_price instead:
      // `SELECT COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(selling_price, 0)), 0) AS inventoryValue FROM products`
    );

    res.json({
      totalProducts: Number(totalRow.totalProducts || 0),
      lowStockCount: Number(lowRow.lowStockCount || 0),
      inventoryValue: Number(valueRow.inventoryValue || 0),
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
