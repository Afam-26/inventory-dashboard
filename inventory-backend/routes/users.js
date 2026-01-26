// routes/users.js
import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Tenant admins/owners only
router.use(requireAuth, requireTenant, requireRole("owner", "admin"));

/**
 * GET /api/users
 * List tenant members (tenant-scoped)
 */
router.get("/", async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const [rows] = await db.query(
      `
      SELECT 
        u.id,
        u.full_name,
        u.email,
        tm.role,
        tm.created_at
      FROM tenant_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.tenant_id = ?
      ORDER BY u.id DESC
      `,
      [tenantId]
    );

    res.json({ users: rows });
  } catch (err) {
    console.error("USERS LIST ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * POST /api/users
 * Add user to tenant:
 * Body: { full_name, email, password, role } OR { email, role } if user already exists
 */
router.post("/", async (req, res) => {
  const tenantId = req.tenantId;

  const full_name = String(req.body?.full_name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const role = String(req.body?.role || "staff").trim().toLowerCase();

  if (!email) return res.status(400).json({ message: "email required" });
  if (!["owner", "admin", "staff"].includes(role)) {
    return res.status(400).json({ message: "role must be owner, admin, or staff" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Find user
    const [urows] = await conn.query(
      "SELECT id FROM users WHERE email=? LIMIT 1",
      [email]
    );

    let userId = urows[0]?.id;

    // Create user if not exists
    if (!userId) {
      if (!password || password.length < 8) {
        await conn.rollback();
        return res.status(400).json({ message: "password required (min 8 chars) for new user" });
      }

      const hash = await bcrypt.hash(password, 10);

      const [r] = await conn.query(
        "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'user')",
        [full_name || null, email, hash]
      );
      userId = r.insertId;

      await logAudit(req, {
        action: "USER_CREATE",
        entity_type: "user",
        entity_id: userId,
        details: { email, full_name: full_name || null },
      }, { db: conn });

    }

    // Add membership (or update role if exists)
    const [mr] = await conn.query(
      `
      INSERT INTO tenant_members (tenant_id, user_id, role, created_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE role=VALUES(role)
      `,
      [tenantId, userId, role]
    );

    await logAudit(req, {
      action: "TENANT_MEMBER_UPSERT",
      entity_type: "tenant_member",
      entity_id: userId,
      details: { tenantId, userId, role, affectedRows: mr.affectedRows },
    });

    await conn.commit();
    res.status(201).json({ ok: true, userId, role });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error("USER UPSERT ERROR:", err);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});

/**
 * PATCH /api/users/:id/role
 * Body: { role }
 */
router.patch("/:id/role", async (req, res) => {
  const tenantId = req.tenantId;
  const userId = Number(req.params.id);
  const role = String(req.body?.role || "").trim().toLowerCase();

  if (!userId) return res.status(400).json({ message: "Invalid user id" });
  if (!["owner", "admin", "staff"].includes(role)) {
    return res.status(400).json({ message: "role must be owner, admin, or staff" });
  }

  try {
    const [r] = await db.query(
      `UPDATE tenant_members
       SET role=?
       WHERE tenant_id=? AND user_id=?`,
      [role, tenantId, userId]
    );

    if (r.affectedRows === 0) return res.status(404).json({ message: "Member not found" });

    await logAudit(req, {
      action: "TENANT_MEMBER_ROLE_UPDATE",
      entity_type: "tenant_member",
      entity_id: userId,
      details: { tenantId, userId, role },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("USER ROLE UPDATE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * DELETE /api/users/:id
 * Remove user from tenant (does not delete user globally)
 */
router.delete("/:id", async (req, res) => {
  const tenantId = req.tenantId;
  const userId = Number(req.params.id);

  if (!userId) return res.status(400).json({ message: "Invalid user id" });

  try {
    const [r] = await db.query(
      `DELETE FROM tenant_members WHERE tenant_id=? AND user_id=?`,
      [tenantId, userId]
    );

    if (r.affectedRows === 0) return res.status(404).json({ message: "Member not found" });

    await logAudit(req, {
      action: "TENANT_MEMBER_REMOVE",
      entity_type: "tenant_member",
      entity_id: userId,
      details: { tenantId, userId },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("USER REMOVE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
