// routes/settings.js
import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";

const router = express.Router();

// must be tenant scoped
router.use(requireAuth, requireTenant);

/**
 * Ensure a row exists for this tenant (lazy create)
 * ✅ includes drift threshold default
 */
async function ensureSettingsRow(tenantId) {
  await db.query(
    `
    INSERT INTO settings (tenant_id, low_stock_threshold, stock_drift_threshold)
    VALUES (?, 10, 5)
    ON DUPLICATE KEY UPDATE tenant_id = tenant_id
    `,
    [tenantId]
  );
}

/**
 * GET /api/settings
 * Returns per-tenant settings
 * ✅ single GET route only (removed duplicate)
 */
router.get("/", async (req, res) => {
  const tenantId = req.tenantId;

  try {
    await ensureSettingsRow(tenantId);

    const [[row]] = await db.query(
      `
      SELECT
        COALESCE(low_stock_threshold,10) AS low_stock_threshold,
        COALESCE(stock_drift_threshold,5) AS stock_drift_threshold
      FROM settings
      WHERE tenant_id=? LIMIT 1
      `,
      [tenantId]
    );

    return res.json({
      low_stock_threshold: Number(row?.low_stock_threshold || 10),
      stock_drift_threshold: Number(row?.stock_drift_threshold || 5),
    });
  } catch (e) {
    console.error("GET SETTINGS ERROR:", e?.message || e);
    return res.status(500).json({ message: "Database error" });
  }
});

/**
 * PUT /api/settings/low-stock-threshold
 * owner/admin only
 * Body: { value: number }
 */
router.put("/low-stock-threshold", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;

  const value = Number(req.body?.value);
  if (!Number.isFinite(value) || value < 1 || value > 99999) {
    return res.status(400).json({ message: "value must be a number >= 1" });
  }

  try {
    await ensureSettingsRow(tenantId);

    await db.query(
      `
      UPDATE settings
      SET low_stock_threshold = ?
      WHERE tenant_id = ?
      `,
      [Math.floor(value), tenantId]
    );

    await logAudit(req, {
      action: "TENANT_SETTING_UPDATE",
      entity_type: "tenant",
      entity_id: tenantId,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: { key: "low_stock_threshold", value: Math.floor(value) },
    });

    return res.json({ ok: true, low_stock_threshold: Math.floor(value) });
  } catch (e) {
    console.error("PUT SETTINGS ERROR:", e?.message || e);
    return res.status(500).json({ message: "Database error" });
  }
});

/**
 * PUT /api/settings/stock-drift-threshold
 * owner/admin only
 * Body: { value: number }
 */
router.put("/stock-drift-threshold", requireRole("owner", "admin"), async (req, res) => {
  const tenantId = req.tenantId;

  const value = Math.floor(Number(req.body?.value));
  if (!Number.isFinite(value) || value < 1 || value > 99999) {
    return res.status(400).json({ message: "value must be a number >= 1" });
  }

  try {
    await ensureSettingsRow(tenantId);

    await db.query(
      `
      UPDATE settings
      SET stock_drift_threshold = ?
      WHERE tenant_id = ?
      `,
      [value, tenantId]
    );

    await logAudit(req, {
      action: "TENANT_SETTING_UPDATE",
      entity_type: "tenant",
      entity_id: tenantId,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: { key: "stock_drift_threshold", value },
    });

    return res.json({ ok: true, stock_drift_threshold: value });
  } catch (e) {
    console.error("PUT DRIFT THRESHOLD ERROR:", e?.message || e);
    return res.status(500).json({ message: "Database error" });
  }
});

export default router;
