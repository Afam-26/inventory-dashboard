// utils/audit.js
import { db } from "../config/db.js";

/**
 * logAudit(req, { action, entity_type, entity_id, details })
 *
 * Writes into MySQL audit_logs table schema:
 * (user_id, user_email, action, entity_type, entity_id, details, ip_address, user_agent)
 *
 * Best-effort: never crashes your API if auditing fails.
 */
export async function logAudit(
  req,
  { action, entity_type, entity_id = null, details = null, user_id = null, user_email = null }
) {
  try {
    const resolvedUserId = user_id ?? req.user?.id ?? null;
    const resolvedUserEmail =
      (user_email ?? req.user?.email ?? null)?.toLowerCase?.() ?? null;

    const ipAddress =
      (req.headers["x-forwarded-for"]?.toString().split(",")[0] || "").trim() ||
      req.socket?.remoteAddress ||
      null;

    const userAgent = req.headers["user-agent"] || null;

    const safeDetails =
      details == null
        ? null
        : typeof details === "object"
        ? details
        : { value: details };

    await db.query(
      `INSERT INTO audit_logs
        (user_id, user_email, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resolvedUserId,
        resolvedUserEmail,
        action,
        entity_type,
        entity_id,
        safeDetails ? JSON.stringify(safeDetails) : null,
        ipAddress,
        userAgent,
      ]
    );
  } catch (err) {
    console.error("AUDIT LOG ERROR:", err?.message || err);
  }
}
