// routes/health.js
import express from "express";
import { db } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenant } from "../middleware/auth.js";
import { verifyAuditChain } from "../utils/audit.js";

const router = express.Router();

/**
 * GET /api/health/audit
 * Tenant-scoped: requires tenant token (tenantId inside JWT)
 *
 * Returns:
 * - chainOk + details
 * - latest snapshot row (if exists)
 * - latest hashed audit row info
 */
router.get("/audit", requireAuth, requireTenant, async (req, res) => {
  try {
    const tenantId = Number(req.tenantId);

    // 1) Verify audit chain for this tenant (only hashed portion)
    const verify = await verifyAuditChain(db, { limit: 20000, tenantId });

    // 2) Latest snapshot (if any)
    const [[snapshot]] = await db.query(
      `
      SELECT tenant_id, snapshot_date, start_id, end_id, end_row_hash,
             events_count, last_created_at_iso, snapshot_hash, created_at
      FROM audit_daily_snapshots
      WHERE tenant_id = ?
      ORDER BY snapshot_date DESC
      LIMIT 1
      `,
      [tenantId]
    );

    // 3) Latest hashed row
    const [[latestRow]] = await db.query(
      `
      SELECT id, created_at_iso, row_hash
      FROM audit_logs
      WHERE tenant_id = ?
        AND row_hash IS NOT NULL
        AND created_at_iso IS NOT NULL
      ORDER BY id DESC
      LIMIT 1
      `,
      [tenantId]
    );

    return res.json({
      ok: true,
      tenantId,
      chain: verify,
      latestHashedRow: latestRow || null,
      latestSnapshot: snapshot || null,
    });
  } catch (e) {
    console.error("HEALTH /audit ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, message: "Health audit failed" });
  }
});

export default router;
