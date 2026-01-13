import express from "express";
import { db } from "../config/db.js";
import { requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name FROM categories ORDER BY name ASC");
    res.json(rows);
  } catch (err) {
    console.error("CATEGORIES GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

router.post("/", requireRole("admin"), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Name is required" });

    await db.query("INSERT INTO categories (name) VALUES (?)", [name.trim()]);
    res.json({ message: "Category created" });
  } catch (err) {
    console.error("CATEGORIES POST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
