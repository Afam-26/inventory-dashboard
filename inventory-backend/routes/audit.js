// routes/audit.js
import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ✅ all audit routes require auth + tenant
router.use(requireAuth, requireTenant);

/**
 * Small helper: JSON may come back as string or object depending on column type + mysql2 config
 */
function normalizeDetails(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

/**
 * GET /api/audit
 * Query:
 *  - page (default 1)
 *  - limit (default 50)
 *  - action (optional)
 *  - user_email (optional)
 *
 * ✅ Owner/Admin: can view all logs for tenant
 * ✅ Staff: only their own logs
 */
router.get("/", async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const role = String(req.user?.role || "").toLowerCase();
    const isAdmin = role === "owner" || role === "admin";

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const offset = (page - 1) * limit;

    const action = String(req.query.action || "").trim();
    const userEmail = String(req.query.user_email || "").trim().toLowerCase();

    const where = ["tenant_id = ?"];
    const params = [tenantId];

    if (!isAdmin) {
      where.push("user_id = ?");
      params.push(req.user?.id ?? 0);
    }

    if (action) {
      where.push("action = ?");
      params.push(action);
    }

    if (userEmail) {
      where.push("LOWER(user_email) = ?");
      params.push(userEmail);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
      params
    );

    const [rows] = await db.query(
      `
      SELECT
        id, user_id, user_email, action, entity_type, entity_id,
        details, ip_address, created_at, created_at_iso, tenant_id
      FROM audit_logs
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    res.json({
      page,
      limit,
      total: Number(countRow?.total || 0),
      logs: (rows || []).map((r) => ({ ...r, details: normalizeDetails(r.details) })),
    });
  } catch (e) {
    console.error("AUDIT LIST ERROR:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/audit/stats?days=30
 */
router.get("/stats", async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const role = String(req.user?.role || "").toLowerCase();
    const isAdmin = role === "owner" || role === "admin";

    const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));

    const baseWhere = ["tenant_id = ?", "created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)"];
    const baseParams = [tenantId, days];

    if (!isAdmin) {
      baseWhere.push("user_id = ?");
      baseParams.push(req.user?.id ?? 0);
    }

    const whereSql = `WHERE ${baseWhere.join(" AND ")}`;

    const [byDay] = await db.query(
      `
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM audit_logs
      ${whereSql}
      GROUP BY DATE(created_at)
      ORDER BY day ASC
      `,
      baseParams
    );

    const [byAction] = await db.query(
      `
      SELECT action, COUNT(*) AS count
      FROM audit_logs
      ${whereSql}
      GROUP BY action
      ORDER BY count DESC
      `,
      baseParams
    );

    const [byEntity] = await db.query(
      `
      SELECT entity_type, COUNT(*) AS count
      FROM audit_logs
      ${whereSql}
      GROUP BY entity_type
      ORDER BY count DESC
      `,
      baseParams
    );

    const [topUsers] = await db.query(
      `
      SELECT user_email, COUNT(*) AS count
      FROM audit_logs
      ${whereSql}
      GROUP BY user_email
      ORDER BY count DESC
      LIMIT 10
      `,
      baseParams
    );

    const total = (byAction || []).reduce((sum, a) => sum + Number(a.count || 0), 0);

    res.json({
      days,
      total,
      byDay: byDay || [],
      byAction: byAction || [],
      byEntity: byEntity || [],
      topUsers: topUsers || [],
    });
  } catch (e) {
    console.error("AUDIT STATS ERROR:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/audit/csv?limit=20000
 */
router.get("/csv", async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const role = String(req.user?.role || "").toLowerCase();
    const isAdmin = role === "owner" || role === "admin";

    const limit = Math.min(50000, Math.max(1, Number(req.query.limit || 20000)));

    const where = ["tenant_id = ?"];
    const params = [tenantId];

    if (!isAdmin) {
      where.push("user_id = ?");
      params.push(req.user?.id ?? 0);
    }

    const [rows] = await db.query(
      `
      SELECT
        id, created_at, created_at_iso, user_email, action,
        entity_type, entity_id, ip_address
      FROM audit_logs
      WHERE ${where.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?
      `,
      [...params, limit]
    );

    const header = [
      "id",
      "created_at",
      "created_at_iso",
      "user_email",
      "action",
      "entity_type",
      "entity_id",
      "ip_address",
    ];

    const escape = (v) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };

    const lines = [header.join(",")];
    for (const r of rows || []) {
      lines.push(
        [
          escape(r.id),
          escape(r.created_at),
          escape(r.created_at_iso),
          escape(r.user_email),
          escape(r.action),
          escape(r.entity_type),
          escape(r.entity_id),
          escape(r.ip_address),
        ].join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit_logs.csv"`);
    res.send(lines.join("\n"));
  } catch (e) {
    console.error("AUDIT CSV ERROR:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * ✅ GET /api/audit/report?days=7
 * SOC-style summary
 * Admin/Owner only
 */
router.get("/report", requireRole("owner", "admin"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const days = Math.min(365, Math.max(1, Number(req.query.days || 7)));

    const whereSql = `WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`;
    const baseParams = [tenantId, days];

    const [[totalRow]] = await db.query(
      `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
      baseParams
    );

    const [[loginsRow]] = await db.query(
      `SELECT COUNT(*) AS c FROM audit_logs ${whereSql} AND action = 'LOGIN'`,
      baseParams
    );

    const [[failedLoginsRow]] = await db.query(
      `SELECT COUNT(*) AS c FROM audit_logs ${whereSql} AND action = 'LOGIN_FAILED'`,
      baseParams
    );

    const [[roleChangesRow]] = await db.query(
      `SELECT COUNT(*) AS c FROM audit_logs ${whereSql} AND action = 'USER_ROLE_UPDATE'`,
      baseParams
    );

    const [failedByEmail] = await db.query(
      `
      SELECT user_email, COUNT(*) AS count
      FROM audit_logs
      ${whereSql} AND action = 'LOGIN_FAILED' AND user_email IS NOT NULL
      GROUP BY user_email
      ORDER BY count DESC
      LIMIT 10
      `,
      baseParams
    );

    const [failedByIp] = await db.query(
      `
      SELECT ip_address, COUNT(*) AS count
      FROM audit_logs
      ${whereSql} AND action = 'LOGIN_FAILED' AND ip_address IS NOT NULL
      GROUP BY ip_address
      ORDER BY count DESC
      LIMIT 10
      `,
      baseParams
    );

    const [afterHours] = await db.query(
      `
      SELECT id, user_email, ip_address, created_at, action
      FROM audit_logs
      ${whereSql}
        AND action = 'LOGIN'
        AND (HOUR(created_at) < 8 OR HOUR(created_at) >= 18)
      ORDER BY id DESC
      LIMIT 50
      `,
      baseParams
    );

    const [destructive] = await db.query(
      `
      SELECT id, user_email, ip_address, created_at, action, entity_type, entity_id
      FROM audit_logs
      ${whereSql}
        AND action LIKE '%DELETE%'
      ORDER BY id DESC
      LIMIT 50
      `,
      baseParams
    );

    res.json({
      generated_at: new Date().toISOString(),
      window_days: days,
      summary: {
        total_events: Number(totalRow?.total || 0),
        logins: Number(loginsRow?.c || 0),
        failed_logins: Number(failedLoginsRow?.c || 0),
        role_changes: Number(roleChangesRow?.c || 0),
      },
      findings: {
        failed_logins_by_email: failedByEmail || [],
        failed_logins_by_ip: failedByIp || [],
        after_hours_logins: afterHours || [],
        destructive_events: destructive || [],
      },
    });
  } catch (e) {
    console.error("AUDIT REPORT ERROR:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/audit/verify?limit=20000
 * Admin/Owner only
 */
router.get("/verify", requireRole("owner", "admin"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const limit = Math.min(50000, Math.max(1, Number(req.query.limit || 20000)));

    const [rows] = await db.query(
      `
      SELECT id, prev_hash, row_hash, created_at_iso, tenant_id, action, entity_type, entity_id, user_email
      FROM audit_logs
      WHERE tenant_id = ?
      ORDER BY id ASC
      LIMIT ?
      `,
      [tenantId, limit]
    );

    let lastHash = null;
    let checked = 0;

    for (const row of rows || []) {
      checked++;

      if (row.prev_hash && lastHash && row.prev_hash !== lastHash) {
        return res.json({
          ok: false,
          checked,
          tenantId,
          brokenAtId: row.id,
          reason: "prev_hash mismatch",
        });
      }

      lastHash = row.row_hash || lastHash;
    }

    res.json({
      ok: true,
      checked,
      tenantId,
      startId: rows?.[0]?.id ?? null,
      lastId: rows?.[rows.length - 1]?.id ?? null,
    });
  } catch (e) {
    console.error("AUDIT VERIFY ERROR:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
