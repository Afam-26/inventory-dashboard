import { db } from "../config/db.js";

export async function audit(req, { action, entity_type, entity_id = null, details = null }) {
  try {
    const user = req.user || null;

    await db.query(
      `INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user?.id || null,
        user?.email || null,
        action,
        entity_type,
        entity_id,
        details ? JSON.stringify(details) : null,
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
        (req.headers["user-agent"] || "").slice(0, 255),
      ]
    );
  } catch (e) {
    // don't block the main request if audit fails
    console.error("AUDIT LOG ERROR:", e.message);
  }
}
