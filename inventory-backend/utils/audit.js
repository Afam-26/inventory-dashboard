// utils/audit.js
import { db } from "../config/db.js";

/**
 * logAudit(req, { action, entity, entity_id, metadata })
 *
 * Matches schema used in routes/audit.js:
 * actor_user_id, actor_email, actor_role, action, entity, entity_id,
 * metadata, ip, user_agent, created_at
 */
export async function logAudit(req, { action, entity = null, entity_id = null, metadata = {} }) {
  try {
    const actorUserId = req.user?.id ?? null;
    const actorEmail = (req.user?.email ?? null)?.toLowerCase?.() ?? null;
    const actorRole = req.user?.role ?? null;

    const ip =
      (req.headers["x-forwarded-for"]?.toString().split(",")[0] || "").trim() ||
      req.socket?.remoteAddress ||
      null;

    const userAgent = req.headers["user-agent"] || null;

    // If your schema has metadata JSON/TEXT
    const meta = metadata && typeof metadata === "object" ? metadata : { value: metadata };

    await db.query(
      `INSERT INTO audit_logs
        (actor_user_id, actor_email, actor_role, action, entity, entity_id, metadata, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorUserId,
        actorEmail,
        actorRole,
        action,
        entity,
        entity_id,
        JSON.stringify(meta),
        ip,
        userAgent,
      ]
    );
  } catch (err) {
    console.error("AUDIT LOG ERROR:", err?.message || err);
  }
}
