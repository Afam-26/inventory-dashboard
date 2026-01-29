// routes/dashboard.js
import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireTenant } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";

const router = express.Router();
const INVENTORY_VALUE_AUDIT_COOLDOWN_MINUTES = 15;

async function safeAudit(req, entry) {
  try {
    await logAudit(req, entry);
  } catch (e) {
    // ✅ audit must NEVER break dashboard
    console.error("DASHBOARD AUDIT FAILED (ignored):", e?.code || e?.message || e);
  }
}

router.get("/", requireAuth, requireTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const role = String(req.user?.role || "").toLowerCase();
    const isAdmin = role === "owner" || role === "admin";
    const userId = req.user?.id ?? null;

    const [[totalProducts]] = await db.query(
      `SELECT COUNT(*) AS c FROM products WHERE tenant_id=?`,
      [tenantId]
    );

    const [[lowStock]] = await db.query(
      `
      SELECT COUNT(*) AS c
      FROM products
      WHERE tenant_id=?
        AND COALESCE(quantity,0) <= COALESCE(reorder_level,0)
      `,
      [tenantId]
    );

    const [[categories]] = await db.query(
      `SELECT COUNT(*) AS c FROM categories WHERE tenant_id=?`,
      [tenantId]
    );

    const [[members]] = await db.query(
      `SELECT COUNT(*) AS c FROM tenant_members WHERE tenant_id=? AND status='active'`,
      [tenantId]
    );

    let inventoryValue = null;

    if (isAdmin) {
      const [[v]] = await db.query(
        `
        SELECT COALESCE(SUM(COALESCE(quantity,0)*COALESCE(cost_price,0)),0) AS v
        FROM products WHERE tenant_id=?
        `,
        [tenantId]
      );

      inventoryValue = Number(v?.v || 0);

      // cooldown check
      let shouldLog = true;
      if (userId) {
        const [[recent]] = await db.query(
          `
          SELECT id FROM audit_logs
          WHERE tenant_id=?
            AND user_id=?
            AND action='DASHBOARD_INVENTORY_VALUE_VIEW'
            AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
          LIMIT 1
          `,
          [tenantId, userId, INVENTORY_VALUE_AUDIT_COOLDOWN_MINUTES]
        );
        if (recent?.id) shouldLog = false;
      }

      if (shouldLog) {
        // ✅ fire-and-forget (no await) so deadlocks can't break response
        void safeAudit(req, {
          action: "DASHBOARD_INVENTORY_VALUE_VIEW",
          entity_type: "dashboard",
          entity_id: null,
          details: { inventoryValue },
          user_id: userId,
          user_email: req.user?.email ?? null,
        });
      }
    }

    return res.json({
      totalProducts: Number(totalProducts?.c || 0),
      lowStockCount: Number(lowStock?.c || 0),
      categories: Number(categories?.c || 0),
      members: Number(members?.c || 0),
      inventoryValue,
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

export default router;
