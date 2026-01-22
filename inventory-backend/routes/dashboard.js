import express from "express";
import { db } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";

const router = express.Router();

const INVENTORY_VALUE_AUDIT_COOLDOWN_MINUTES = 15;

router.get("/", requireAuth, async (req, res) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const userId = req.user?.id ?? null;

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

    // 3) inventory value (admin-only)
    let inventoryValue = null;

    if (isAdmin) {
      const [[valueRow]] = await db.query(
        `SELECT COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(cost_price, 0)), 0) AS inventoryValue
         FROM products`
      );

      inventoryValue = Number(valueRow.inventoryValue || 0);

      // ✅ cooldown: only audit once per admin per 15 minutes
      let shouldLog = true;

      if (userId) {
        const [[recent]] = await db.query(
          `
          SELECT id
          FROM audit_logs
          WHERE user_id = ?
            AND action = 'DASHBOARD_INVENTORY_VALUE_VIEW'
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
          LIMIT 1
          `,
          [userId, INVENTORY_VALUE_AUDIT_COOLDOWN_MINUTES]
        );

        if (recent?.id) shouldLog = false;
      }

      if (shouldLog) {
        await logAudit(req, {
          action: "DASHBOARD_INVENTORY_VALUE_VIEW",
          entity_type: "dashboard",
          entity_id: null,
          details: { success: true, inventory_value_returned: true },
          user_id: userId,
          user_email: req.user?.email ?? null,
        });
      }
    }

    res.json({
      totalProducts: Number(totalRow.totalProducts || 0),
      lowStockCount: Number(lowRow.lowStockCount || 0),
      inventoryValue, // admin => number, staff => null
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
