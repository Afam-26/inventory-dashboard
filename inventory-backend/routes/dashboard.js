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

    // ✅ use tenantRole when present
    const role = String(req.user?.tenantRole || req.user?.role || "").toLowerCase();
    const isOwner = role === "owner";

    const userId = req.user?.id ?? null;

    // ✅ exclude deleted products everywhere in dashboard
    const [[totalProducts]] = await db.query(
      `SELECT COUNT(*) AS c FROM products WHERE tenant_id=? AND deleted_at IS NULL`,
      [tenantId]
    );

    // ✅ match Products.jsx logic:
    // threshold = (reorder_level > 0 ? reorder_level : settings.low_stock_threshold)
    // low if quantity <= threshold
   const [[lowStock]] = await db.query(
      `
      SELECT COUNT(*) AS c
      FROM products p
      LEFT JOIN settings s ON s.tenant_id = p.tenant_id
      WHERE p.tenant_id=?
        AND p.deleted_at IS NULL
        AND COALESCE(p.quantity,0) <= (
          CASE
            WHEN COALESCE(p.reorder_level,0) > 0 THEN COALESCE(p.reorder_level,0)
            ELSE COALESCE(s.low_stock_threshold, 10)
          END
        )
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

    // ✅ Owner-only now
    if (isOwner) {
      const [[v]] = await db.query(
        `
        SELECT COALESCE(SUM(COALESCE(quantity,0)*COALESCE(cost_price,0)),0) AS v
        FROM products
        WHERE tenant_id=? AND deleted_at IS NULL
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
      inventoryValue, // admin will now receive null
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    return res.status(500).json({ message: "Database error" });
  }
});

export default router;
