// routes/audit.js
import express from "express";
import rateLimit from "express-rate-limit";
import { db } from "../config/db.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";
import { verifyAuditChain } from "../utils/audit.js";

const router = express.Router();

// ✅ Tenant-scoped + owner/admin only
router.use(requireAuth, requireTenant, requireRole("owner", "admin"));

const auditLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const needs = /[,"\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needs ? `"${escaped}"` : escaped;
}

/**
 * Build WHERE clause + params for audit queries (tenant-safe).
 * Owner/Admin can filter by user_email, action, entity_type, and query text.
 */
function buildAuditWhere(req) {
  const q = String(req.query.q || "").trim();
  const action = String(req.query.action || "").trim();
  const entity_type = String(req.query.entity_type || "").trim();
  const user_email = String(req.query.user_email || "").trim().toLowerCase();

  const where = [];
  const params = [];

  // ✅ Always tenant scope first
  where.push("tenant_id = ?");
  params.push(req.tenantId);

  if (action) {
    where.push("action = ?");
    params.push(action);
  }

  if (entity_type) {
    where.push("entity_type = ?");
    params.push(entity_type);
  }

  if (user_email) {
    where.push("LOWER(user_email) = LOWER(?)");
    params.push(user_email);
  }

  if (q) {
    const like = `%${q}%`;
    where.push(
      `(LOWER(user_email) LIKE LOWER(?) OR action LIKE ? OR entity_type LIKE ? OR CAST(entity_id AS CHAR) LIKE ?)`
    );
    params.push(like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { whereSql, params };
}

/**
 * GET /api/audit
 * Owner/Admin: tenant logs
 */
router.get("/", async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 500)));

    const [rows] = await db.query(
      `
      SELECT id, user_id, user_email, action, entity_type, entity_id, details, ip_address, user_agent, created_at
      FROM audit_logs
      WHERE tenant_id = ?
      ORDER BY id DESC
      LIMIT ?
      `,
      [tenantId, limit]
    );

    res.json({ logs: rows });
  } catch (err) {
    console.error("AUDIT LIST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * ✅ Verify tamper-evident chain (Owner/Admin only)
 * GET /api/admin/audit/verify?limit=20000
 *
 * IMPORTANT:
 * This assumes verifyAuditChain() internally validates hashes/prev_hash ordering.
 * ✅ We pass tenant_id so verification is per-tenant.
 */
router.get("/verify", async (req, res) => {
  try {
    const limit = Math.min(50000, Math.max(1, Number(req.query.limit || 20000)));
    const startId = req.query.startId ? Number(req.query.startId) : null;

    const result = await verifyAuditChain(db, {
      limit,
      tenantId: req.tenantId,
      startId,
    });

    res.json(result);
  } catch (err) {
    console.error("AUDIT VERIFY ERROR:", err);
    res.status(500).json({ message: "Audit verification failed" });
  }
});


/**
 * ✅ CSV Export (Owner/Admin only)
 * GET /api/audit/export.csv
 */
router.get("/export.csv", auditLimiter, async (req, res) => {
  try {
    const { whereSql, params } = buildAuditWhere(req);
    const limit = Math.min(50000, Math.max(1, Number(req.query.limit || 5000)));

    const [rows] = await db.query(
      `
      SELECT
        id, user_id, user_email, action, entity_type, entity_id,
        details, ip_address, user_agent, created_at
      FROM audit_logs
      ${whereSql}
      ORDER BY id DESC
      LIMIT ?
      `,
      [...params, limit]
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit_logs.csv"`);

    res.write(
      [
        "id",
        "user_id",
        "user_email",
        "action",
        "entity_type",
        "entity_id",
        "details",
        "ip_address",
        "user_agent",
        "created_at",
      ].join(",") + "\n"
    );

    for (const r of rows) {
      const line = [
        r.id,
        r.user_id,
        r.user_email,
        r.action,
        r.entity_type,
        r.entity_id,
        r.details,
        r.ip_address,
        r.user_agent,
        r.created_at,
      ]
        .map(csvEscape)
        .join(",");
      res.write(line + "\n");
    }

    res.end();
  } catch (err) {
    console.error("AUDIT CSV ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * ✅ Stats for charts (Owner/Admin only)
 * GET /api/audit/stats?days=30
 */
router.get("/stats", auditLimiter, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));

    const [byDay] = await db.query(
      `
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY day ASC
      `,
      [tenantId, days]
    );

    const [byAction] = await db.query(
      `
      SELECT action, COUNT(*) AS count
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY action
      ORDER BY count DESC
      LIMIT 20
      `,
      [tenantId, days]
    );

    const [byEntity] = await db.query(
      `
      SELECT entity_type, COUNT(*) AS count
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY entity_type
      ORDER BY count DESC
      LIMIT 20
      `,
      [tenantId, days]
    );

    const [topUsers] = await db.query(
      `
      SELECT user_email, COUNT(*) AS count
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND user_email IS NOT NULL
      GROUP BY user_email
      ORDER BY count DESC
      LIMIT 20
      `,
      [tenantId, days]
    );

    res.json({ days, byDay, byAction, byEntity, topUsers });
  } catch (err) {
    console.error("AUDIT STATS ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * ✅ SOC-style report (Owner/Admin only)
 * GET /api/audit/report?days=7
 */
router.get("/report", auditLimiter, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const days = Math.min(365, Math.max(1, Number(req.query.days || 7)));

    const [[summary]] = await db.query(
      `
      SELECT
        COUNT(*) AS total_events,
        SUM(action='LOGIN') AS logins,
        SUM(action='LOGIN_FAILED') AS failed_logins,
        SUM(action LIKE '%DELETE%') AS deletes,
        SUM(action='USER_ROLE_UPDATE') AS role_changes
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `,
      [tenantId, days]
    );

    const [failedByEmail] = await db.query(
      `
      SELECT user_email, COUNT(*) AS count
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action='LOGIN_FAILED'
        AND user_email IS NOT NULL
      GROUP BY user_email
      ORDER BY count DESC
      LIMIT 20
      `,
      [tenantId, days]
    );

    const [failedByIp] = await db.query(
      `
      SELECT ip_address, COUNT(*) AS count
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action='LOGIN_FAILED'
        AND ip_address IS NOT NULL
      GROUP BY ip_address
      ORDER BY count DESC
      LIMIT 20
      `,
      [tenantId, days]
    );

    const [roleEvents] = await db.query(
      `
      SELECT id, user_email, action, entity_type, entity_id, details, ip_address, created_at
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action='USER_ROLE_UPDATE'
      ORDER BY id DESC
      LIMIT 200
      `,
      [tenantId, days]
    );

    const [deleteEvents] = await db.query(
      `
      SELECT id, user_email, action, entity_type, entity_id, details, ip_address, created_at
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action LIKE '%DELETE%'
      ORDER BY id DESC
      LIMIT 200
      `,
      [tenantId, days]
    );

    const [afterHoursLogins] = await db.query(
      `
      SELECT id, user_email, ip_address, created_at, details
      FROM audit_logs
      WHERE tenant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action='LOGIN'
        AND (HOUR(created_at) < 7 OR HOUR(created_at) >= 19)
      ORDER BY id DESC
      LIMIT 200
      `,
      [tenantId, days]
    );

    res.json({
      generated_at: new Date().toISOString(),
      window_days: days,
      summary: {
        total_events: Number(summary?.total_events || 0),
        logins: Number(summary?.logins || 0),
        failed_logins: Number(summary?.failed_logins || 0),
        deletes: Number(summary?.deletes || 0),
        role_changes: Number(summary?.role_changes || 0),
      },
      findings: {
        failed_logins_by_email: failedByEmail,
        failed_logins_by_ip: failedByIp,
        after_hours_logins: afterHoursLogins,
        privileged_changes: roleEvents,
        destructive_events: deleteEvents,
      },
      notes: [
        "After-hours logins are a heuristic; tune hours to your business policy.",
        "Use IP + user_agent correlation to validate unusual activity.",
      ],
    });
  } catch (err) {
    console.error("AUDIT REPORT ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
