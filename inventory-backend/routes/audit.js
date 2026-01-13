import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, user_email, action, entity_type, entity_id, details, ip_address, created_at
       FROM audit_logs
       ORDER BY id DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (e) {
    console.error("AUDIT GET ERROR:", e);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
