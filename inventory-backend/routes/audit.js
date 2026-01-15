// routes/audit.js
import express from "express";
import rateLimit from "express-rate-limit";
import { db } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const auditLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/", requireAuth, auditLimiter, async (req, res) => {
  try {
    const isAdmin = req.user?.role === "admin";

    const q = String(req.query.q || "").trim();
    const action = String(req.query.action || "").trim();
    const entity_type = String(req.query.entity_type || "").trim();
    const user_email = String(req.query.user_email || "").trim().toLowerCase();

    const pageNum = Math.max(1, Number(req.query.page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
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

    // Admin-only filter by email
    if (isAdmin && user_email) {
      where.push("user_email = ?");
      params.push(user_email);
    }

    if (q) {
      where.push(
        `(user_email LIKE ? OR action LIKE ? OR entity_type LIKE ? OR CAST(entity_id AS CHAR) LIKE ?)`
      );
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    // ✅ staff restriction
    if (!isAdmin) {
      where.push("user_id = ?");
      params.push(req.user.id);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

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
        try { d = JSON.parse(d); } catch {}
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

export default router;
