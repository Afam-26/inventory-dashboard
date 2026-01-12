import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// anyone logged in can view
router.get("/", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name FROM categories ORDER BY name ASC"
    );
    res.json(rows);
  } catch (e) {
    console.error("CATEGORIES GET ERROR:", e);
    res.status(500).json({ message: "Database error" });
  }
});

// only admin can create
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Name is required" });

    await db.query("INSERT INTO categories (name) VALUES (?)", [name.trim()]);
    res.json({ message: "Category created" });
  } catch (e) {
    console.error("CATEGORIES POST ERROR:", e);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
