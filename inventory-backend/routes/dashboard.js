import express from "express";
import { db } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/summary", requireAuth, async (req, res) => {
  const [[totalProducts]] = await db.query("SELECT COUNT(*) AS total FROM products");

  const [[lowStock]] = await db.query(
    "SELECT COUNT(*) AS low FROM products WHERE quantity <= reorder_level"
  );

  const [[inventoryValue]] = await db.query(
    "SELECT SUM(quantity * cost_price) AS value FROM products"
  );

  res.json({
    totalProducts: totalProducts.total,
    lowStock: lowStock.low,
    inventoryValue: inventoryValue.value || 0,
  });
});

export default router;
