// routes/users.js
import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../config/db.js";
import { requireAuth, requireRole, requireAdmin } from "../middleware/auth.js";
import { logAudit } from "../utils/audit.js";

const router = express.Router();
const ALLOWED_ROLES = new Set(["admin", "staff"]);

/**
 * GET /api/users
 * Admin-only: list users
 */
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, full_name, email, role, created_at
       FROM users
       ORDER BY id DESC
       LIMIT 500`
    );
    res.json(rows);
  } catch (err) {
    console.error("USERS GET ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * POST /api/users
 * Admin-only: create user (staff/admin)
 * Body: { full_name, email, password, role }
 */
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const full_name = String(req.body?.full_name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "staff").trim().toLowerCase();

    if (!full_name) return res.status(400).json({ message: "Full name is required" });
    if (!email) return res.status(400).json({ message: "Email is required" });
    if (!password || password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ message: "Invalid role. Use admin or staff." });
    }

    const [[exists]] = await db.query("SELECT id FROM users WHERE email=? LIMIT 1", [email]);
    if (exists) return res.status(409).json({ message: "Email already exists" });

    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES (?, ?, ?, ?)`,
      [full_name, email, password_hash, role]
    );

    // ✅ audit with actor info
    await logAudit(req, {
      action: "USER_CREATE",
      entity_type: "user",
      entity_id: result.insertId,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: {
        created_user_id: result.insertId,
        created_email: email,
        created_role: role,
        created_full_name: full_name,
      },
    });

    res.json({
      message: "User created",
      user: { id: result.insertId, full_name, email, role },
    });
  } catch (err) {
    console.error("USERS POST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * PATCH /api/users/:id/role
 * Admin-only: update role
 * Body: { role }
 */
router.patch("/:id/role", requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const roleRaw = req.body?.role;

    const newRole = String(roleRaw || "").trim().toLowerCase();
    if (!targetId || !newRole) {
      return res.status(400).json({ message: "User id and role are required" });
    }
    if (!ALLOWED_ROLES.has(newRole)) {
      return res.status(400).json({ message: "Invalid role. Use admin or staff." });
    }

    // fetch target user + old role (for audit details)
    const [[target]] = await db.query(
      "SELECT id, email, role FROM users WHERE id=? LIMIT 1",
      [targetId]
    );
    if (!target) return res.status(404).json({ message: "User not found" });

    const oldRole = String(target.role || "").toLowerCase();

    if (oldRole === newRole) {
      return res.json({ message: "No change", userId: targetId, role: newRole });
    }

    await db.query("UPDATE users SET role=? WHERE id=?", [newRole, targetId]);

    // ✅ audit (this is what report/dashboard expects)
    await logAudit(req, {
      action: "USER_ROLE_UPDATE",
      entity_type: "user",
      entity_id: targetId,
      user_id: req.user?.id ?? null,
      user_email: req.user?.email ?? null,
      details: {
        target_user_id: targetId,
        target_user_email: target.email,
        old_role: oldRole,
        new_role: newRole,
      },
    });

    return res.json({ message: "Role updated", userId: targetId, role: newRole });
  } catch (err) {
    console.error("ROLE UPDATE ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
