import express from "express";
import rateLimit from "express-rate-limit";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * 🔒 Rate limit audit viewing (prevents scraping / abuse)
 * Admin-only
 */
const auditLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/audit
 * Admin-only audit viewer with filters + pagination
 *
 * Query params:
 *  - q            (search: email/action/entity)
 *  - action       (exact match)
 *  - entity       (exact match)
 *  - actor_email  (exact match)
 *  - page         (default 1)
 *  - limit        (default 50, max 200)
 */
router.get(
  "/",
  requireAuth,
  requireRole("admin"),
  auditLimiter,
  async (req, res) => {
    try {
      // routes/audit.js (inside router.get handler)
const {
  q = "",
  action = "",
  entity_type = "",
  user_email = "",
  page = "1",
  limit = "50",
} = req.query;

const pageNum = Math.max(1, Number(page) || 1);
const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
const offset = (pageNum - 1) * limitNum;

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

if (user_email) {
  where.push("user_email = ?");
  params.push(user_email.toLowerCase());
}

if (q) {
  where.push(
    `(user_email LIKE ? OR action LIKE ? OR entity_type LIKE ? OR CAST(entity_id AS CHAR) LIKE ?)`
  );
  const like = `%${q}%`;
  params.push(like, like, like, like);
}

const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

const [[countRow]] = await db.query(
  `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
  params
);

const [rows] = await db.query(
  `
  SELECT
    id,
    user_id,
    user_email,
    action,
    entity_type,
    entity_id,
    details,
    ip_address,
    user_agent,
    created_at
  FROM audit_logs
  ${whereSql}
  ORDER BY id DESC
  LIMIT ? OFFSET ?
  `,
  [...params, limitNum, offset]
);

// details is JSON already; but some drivers return string
const parsed = rows.map((r) => {
  let d = r.details;
  if (typeof d === "string") {
    try { d = JSON.parse(d); } catch {}
  }
  return { ...r, details: d };
});

await logAudit(req, {
  action: "LOGIN",
  entity_type: "user",
  entity_id: user.id,
  details: { email: user.email, role: user.role },
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
  }
);

export default router;
