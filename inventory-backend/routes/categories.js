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

    const clean = name.trim();

    const [result] = await db.query("INSERT INTO categories (name) VALUES (?)", [clean]);

    await logAudit(req, {
      action: "CATEGORY_CREATE",
      entity_type: "category",
      entity_id: result.insertId,
      details: { name: clean },
    });

    res.json({ message: "Category created", id: result.insertId });
  } catch (err) {
    console.error("CATEGORIES POST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ admin only can delete categories (with in-use protection)
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid category id" });

    const [[current]] = await db.query("SELECT id, name FROM categories WHERE id=? LIMIT 1", [id]);
    if (!current) return res.status(404).json({ message: "Category not found" });

    // prevent deleting category used by products
    const [[used]] = await db.query("SELECT COUNT(*) AS cnt FROM products WHERE category_id=?", [id]);
    if (Number(used.cnt) > 0) {
      return res.status(409).json({
        message: "Category is in use by one or more products. Reassign/remove products first.",
      });
    }

    await db.query("DELETE FROM categories WHERE id=?", [id]);

    await logAudit(req, {
      action: "CATEGORY_DELETE",
      entity_type: "category",
      entity_id: id,
      details: { deleted: current },
    });

    res.json({ message: "Category deleted", deleted: current });
  } catch (err) {
    console.error("CATEGORIES DELETE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
