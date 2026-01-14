import express from "express";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ✅ anyone logged in can view categories
router.get("/", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name FROM categories ORDER BY name ASC");
    res.json(rows);
  } catch (err) {
    console.error("CATEGORIES GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ admin only can create categories
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Name is required" });

    // ✅ INSERT ONCE
    const [result] = await db.query("INSERT INTO categories (name) VALUES (?)", [name.trim()]);

    // ✅ audit (do NOT insert again)
    await logAudit(req, {
      action: "CATEGORY_CREATE",
      entity: "category",
      entity_id: result.insertId,
      metadata: { name: name.trim() },
    });

    res.json({ message: "Category created", id: result.insertId });
  } catch (err) {
    console.error("CATEGORIES POST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
