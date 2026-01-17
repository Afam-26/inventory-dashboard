// routes/audit.js
import express from "express";
import rateLimit from "express-rate-limit";
import { db } from "../config/db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { verifyAuditChain } from "../utils/audit.js";

const router = express.Router();

const auditLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Build WHERE clause + params for audit queries.
 * Rules:
 *  - Admin: can see all, can filter by any user_email
 *  - Staff: can only see their own rows (user_id), user_email filter only allowed if it matches themselves
 */
function buildAuditWhere(req) {
  const isAdmin = req.user?.role === "admin";

  const q = String(req.query.q || "").trim();
  const action = String(req.query.action || "").trim();
  const entity_type = String(req.query.entity_type || "").trim();
  const user_email = String(req.query.user_email || "").trim().toLowerCase();

  const where = [];
  const params = [];

  if (action) {
    where.push("action = ?");
    params.push(action);
  }

  if (entity_type) {
    where.push("entity_type = ?");
    params.push(entity_type);
  }

  // user_email filter:
  if (user_email) {
    if (isAdmin) {
      where.push("user_email = ?");
      params.push(user_email);
    } else {
      const me = (req.user?.email || "").toLowerCase();
      if (user_email !== me) {
        where.push("1=0");
      } else {
        where.push("user_email = ?");
        params.push(me);
      }
    }
  }

  if (q) {
    where.push(
      `(user_email LIKE ? OR action LIKE ? OR entity_type LIKE ? OR CAST(entity_id AS CHAR) LIKE ?)`
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  // ✅ staff restriction always enforced
  if (!isAdmin) {
    where.push("user_id = ?");
    params.push(req.user.id);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { whereSql, params, isAdmin };
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const needs = /[,"\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needs ? `"${escaped}"` : escaped;
}

/**
 * GET /api/audit
 * Admin: all logs
 * Staff: ONLY their own logs
 */
router.get("/", requireAuth, auditLimiter, async (req, res) => {
  try {
    const { whereSql, params } = buildAuditWhere(req);

    const pageNum = Math.max(1, Number(req.query.page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
      params
    );

    const [rows] = await db.query(
      `
      SELECT id, user_id, user_email, action, entity_type, entity_id,
             details, ip_address, user_agent, created_at
      FROM audit_logs
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limitNum, offset]
    );

    const parsed = rows.map((r) => {
      let d = r.details;
      if (typeof d === "string") {
        try {
          d = JSON.parse(d);
        } catch {}
      }
      return { ...r, details: d };
    });

    res.json({
      page: pageNum,
      limit: limitNum,
      total: Number(countRow?.total || 0),
      rows: parsed,
    });
  } catch (err) {
    console.error("AUDIT GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * ✅ Verify tamper-evident chain (Admin-only)
 * GET /api/admin/audit/verify?limit=20000
 */
router.get("/verify", requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20000);
    const result = await verifyAuditChain(db, { limit });
    res.json(result);
  } catch (err) {
    console.error("AUDIT VERIFY ERROR:", err);
    res.status(500).json({ message: "Audit verification failed" });
  }
});

/**
 * ✅ CSV Export (Admin-only)
 * GET /api/audit/export.csv
 */
router.get("/export.csv", requireAuth, auditLimiter, async (req, res) => {
  try {
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin) return res.status(403).json({ message: "Admins only" });

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
 * ✅ Stats for charts (Admin-only)
 * GET /api/audit/stats?days=30
 */
router.get("/stats", requireAuth, auditLimiter, async (req, res) => {
  try {
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin) return res.status(403).json({ message: "Admins only" });

    const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));

    const [byDay] = await db.query(
      `
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)
      ORDER BY day ASC
      `,
      [days]
    );

    const [byAction] = await db.query(
      `
      SELECT action, COUNT(*) AS count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY action
      ORDER BY count DESC
      LIMIT 20
      `,
      [days]
    );

    const [byEntity] = await db.query(
      `
      SELECT entity_type, COUNT(*) AS count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY entity_type
      ORDER BY count DESC
      LIMIT 20
      `,
      [days]
    );

    const [topUsers] = await db.query(
      `
      SELECT user_email, COUNT(*) AS count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND user_email IS NOT NULL
      GROUP BY user_email
      ORDER BY count DESC
      LIMIT 20
      `,
      [days]
    );

    res.json({ days, byDay, byAction, byEntity, topUsers });
  } catch (err) {
    console.error("AUDIT STATS ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * ✅ SOC-style report (Admin-only)
 * GET /api/audit/report?days=7
 */
router.get("/report", requireAuth, auditLimiter, async (req, res) => {
  try {
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin) return res.status(403).json({ message: "Admins only" });

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
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `,
      [days]
    );

    const [failedByEmail] = await db.query(
      `
      SELECT user_email, COUNT(*) AS count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action='LOGIN_FAILED'
        AND user_email IS NOT NULL
      GROUP BY user_email
      ORDER BY count DESC
      LIMIT 20
      `,
      [days]
    );

    const [failedByIp] = await db.query(
      `
      SELECT ip_address, COUNT(*) AS count
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action='LOGIN_FAILED'
        AND ip_address IS NOT NULL
      GROUP BY ip_address
      ORDER BY count DESC
      LIMIT 20
      `,
      [days]
    );

    const [roleEvents] = await db.query(
      `
      SELECT id, user_email, action, entity_type, entity_id, details, ip_address, created_at
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action='USER_ROLE_UPDATE'
      ORDER BY id DESC
      LIMIT 200
      `,
      [days]
    );

    const [deleteEvents] = await db.query(
      `
      SELECT id, user_email, action, entity_type, entity_id, details, ip_address, created_at
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action LIKE '%DELETE%'
      ORDER BY id DESC
      LIMIT 200
      `,
      [days]
    );

    const [afterHoursLogins] = await db.query(
      `
      SELECT id, user_email, ip_address, created_at, details
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND action='LOGIN'
        AND (HOUR(created_at) < 7 OR HOUR(created_at) >= 19)
      ORDER BY id DESC
      LIMIT 200
      `,
      [days]
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
