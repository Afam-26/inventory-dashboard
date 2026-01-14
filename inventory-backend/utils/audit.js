import { db } from "../config/db.js";

/**
 * logAudit(req, { action, entity, entity_id, metadata })
 *
 * - Writes an audit log row into audit_logs table.
 * - Does NOT break your API if audit logging fails (it will just console.error).
 */
export async function logAudit(req, { action, entity = null, entity_id = null, metadata = {} }) {
  try {
    const userId = req.user?.id ?? null;
    const userEmail = req.user?.email ?? null;
    const userRole = req.user?.role ?? null;

    // best-effort client ip
    const ip =
      (req.headers["x-forwarded-for"]?.toString().split(",")[0] || "").trim() ||
      req.socket?.remoteAddress ||
      null;

    const userAgent = req.headers["user-agent"] || null;
    const origin = req.headers.origin || null;
    const path = req.originalUrl || req.url || null;
    const method = req.method || null;

    await db.query(
      `INSERT INTO audit_logs
        (user_id, user_email, user_role, action, entity, entity_id, ip, user_agent, origin, method, path, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        userEmail,
        userRole,
        action,
        entity,
        entity_id,
        ip,
        userAgent,
        origin,
        method,
        path,
        JSON.stringify(metadata || {}),
      ]
    );
  } catch (err) {
    // Don't crash the API if audit fails
    console.error("AUDIT LOG ERROR:", err?.message || err);
  }
}

/**
 * Optional helper if you want a quick endpoint later:
 * e.g. db.query("SELECT ... FROM audit_logs ORDER BY id DESC LIMIT 200")
 */
export async function getRecentAuditLogs(limit = 200) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const [rows] = await db.query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", [lim]);
  return rows;
}
