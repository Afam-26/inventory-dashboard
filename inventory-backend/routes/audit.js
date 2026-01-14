import express from "express";
import rateLimit from "express-rate-limit";
import { db } from "../config/db.js";
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
      const {
        q = "",
        action = "",
        entity = "",
        actor_email = "",
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

      if (entity) {
        where.push("entity = ?");
        params.push(entity);
      }

      if (actor_email) {
        where.push("actor_email = ?");
        params.push(actor_email.toLowerCase());
      }

      if (q) {
        where.push(
          `(actor_email LIKE ? OR action LIKE ? OR entity LIKE ? OR entity_id LIKE ?)`
        );
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      /* total count */
      const [[countRow]] = await db.query(
        `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
        params
      );

      /* rows */
      const [rows] = await db.query(
        `
        SELECT
          id,
          actor_user_id,
          actor_email,
          actor_role,
          action,
          entity,
          entity_id,
          metadata,
          ip,
          user_agent,
          created_at
        FROM audit_logs
        ${whereSql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
        `,
        [...params, limitNum, offset]
      );

      /* parse metadata safely */
      const parsed = rows.map((r) => {
        let meta = r.metadata;
        if (typeof meta === "string") {
          try {
            meta = JSON.parse(meta);
          } catch {
            /* leave as string */
          }
        }
        return { ...r, metadata: meta };
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
