// routes/users.js
import express from "express";
import { db } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
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
 * PATCH /api/users/:id/role
 * Admin-only: update role by user id
 * Body: { role: "admin" | "staff" }
 */
router.patch("/:id/role", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const role = String(req.body?.role || "").trim().toLowerCase();

    if (!targetId) return res.status(400).json({ message: "Invalid user id" });
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ message: "Invalid role. Use admin or staff." });
    }

    // Prevent self-demotion (recommended)
    if (targetId === req.user?.id && role !== "admin") {
      return res.status(400).json({ message: "You cannot remove your own admin role." });
    }

    // Load user
    const [[existing]] = await db.query(
      "SELECT id, email, role FROM users WHERE id=? LIMIT 1",
      [targetId]
    );
    if (!existing) return res.status(404).json({ message: "User not found" });

    const oldRole = existing.role;

    if (oldRole === role) {
      return res.json({
        message: "Role unchanged",
        user: { id: existing.id, email: existing.email, role: oldRole },
      });
    }

    // Update
    await db.query("UPDATE users SET role=? WHERE id=?", [role, targetId]);

    // Audit
    await logAudit(req, {
      action: "USER_ROLE_UPDATE",
      entity_type: "user",
      entity_id: targetId,
      details: {
        target_user_id: targetId,
        target_email: existing.email,
        old_role: oldRole,
        new_role: role,
      },
    });

    res.json({
      message: "Role updated",
      user: { id: existing.id, email: existing.email, role },
    });
  } catch (err) {
    console.error("USER ROLE PATCH ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * PATCH /api/users/role-by-email
 * Admin-only: update role by email
 * Body: { email: "...", role: "admin" | "staff" }
 */
router.patch("/role-by-email", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "").trim().toLowerCase();

    if (!email) return res.status(400).json({ message: "Email is required" });
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ message: "Invalid role. Use admin or staff." });
    }

    const [[existing]] = await db.query(
      "SELECT id, email, role FROM users WHERE email=? LIMIT 1",
      [email]
    );
    if (!existing) return res.status(404).json({ message: "User not found" });

    // Prevent self-demotion (recommended)
    if (existing.id === req.user?.id && role !== "admin") {
      return res.status(400).json({ message: "You cannot remove your own admin role." });
    }

    const oldRole = existing.role;

    if (oldRole === role) {
      return res.json({
        message: "Role unchanged",
        user: { id: existing.id, email: existing.email, role: oldRole },
      });
    }

    await db.query("UPDATE users SET role=? WHERE id=?", [role, existing.id]);

    await logAudit(req, {
      action: "USER_ROLE_UPDATE",
      entity_type: "user",
      entity_id: existing.id,
      details: {
        target_user_id: existing.id,
        target_email: existing.email,
        old_role: oldRole,
        new_role: role,
      },
    });

    res.json({
      message: "Role updated",
      user: { id: existing.id, email: existing.email, role },
    });
  } catch (err) {
    console.error("USER ROLE BY EMAIL PATCH ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
