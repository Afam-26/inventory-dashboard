// routes/users.js
import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Only tenant admins / owners
router.use(requireAuth, requireTenant, requireRole("owner", "admin"));

/**
 * GET /api/users
 */
router.get("/", async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const [rows] = await db.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.email,
        tm.role,
        tm.status,
        tm.created_at
      FROM tenant_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.tenant_id=?
      ORDER BY tm.role='owner' DESC, u.id DESC
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
 */
router.post("/", async (req, res) => {
  const tenantId = req.tenantId;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const full_name = String(req.body?.full_name || "").trim();
  const password = String(req.body?.password || "");
  const role = String(req.body?.role || "staff").toLowerCase();

  if (!email) return res.status(400).json({ message: "email required" });
  if (!["owner", "admin", "staff"].includes(role)) {
    return res.status(400).json({ message: "invalid role" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[u]] = await conn.query(
      "SELECT id FROM users WHERE email=? LIMIT 1",
      [email]
    );

    let userId = u?.id;

    if (!userId) {
      if (password.length < 8) {
        await conn.rollback();
        return res.status(400).json({ message: "password min 8 chars" });
      }

      const hash = await bcrypt.hash(password, 10);
      const [r] = await conn.query(
        "INSERT INTO users (full_name,email,password_hash,role) VALUES (?,?,?,'user')",
        [full_name || null, email, hash]
      );
      userId = r.insertId;

      await logAudit(req, {
        action: "USER_CREATE",
        entity_type: "user",
        entity_id: userId,
        details: { email },
      }, { db: conn });
    }

    await conn.query(
      `
      INSERT INTO tenant_members (tenant_id,user_id,role,status,created_at)
      VALUES (?,?,?,'active',NOW())
      ON DUPLICATE KEY UPDATE role=VALUES(role), status='active'
      `,
      [tenantId, userId, role]
    );

    await logAudit(req, {
      action: "TENANT_MEMBER_UPSERT",
      entity_type: "tenant_member",
      entity_id: userId,
      details: { tenantId, role },
    }, { db: conn });

    await conn.commit();
    res.status(201).json({ ok: true });
  } catch (e) {
  if (e?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ message: "Invite already exists for this email" });
  }
  console.error("INVITE ERROR:", e);
  res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});

/**
 * PATCH /api/users/:id/role
 */
router.patch("/:id/role", async (req, res) => {
  const tenantId = req.tenantId;
  const userId = Number(req.params.id);
  const role = String(req.body?.role || "").toLowerCase();

  if (!["owner", "admin", "staff"].includes(role)) {
    return res.status(400).json({ message: "invalid role" });
  }

  try {
    // prevent removing last owner
    if (role !== "owner") {
      const [[count]] = await db.query(
        `
        SELECT COUNT(*) AS c
        FROM tenant_members
        WHERE tenant_id=? AND role='owner'
        `,
        [tenantId]
      );

      if (count?.c <= 1) {
        return res.status(400).json({ message: "Tenant must have at least one owner" });
      }
    }

    const [r] = await db.query(
      `
      UPDATE tenant_members
      SET role=?
      WHERE tenant_id=? AND user_id=?
      `,
      [role, tenantId, userId]
    );

    if (!r.affectedRows) {
      return res.status(404).json({ message: "Member not found" });
    }

    await logAudit(req, {
      action: "TENANT_MEMBER_ROLE_UPDATE",
      entity_type: "tenant_member",
      entity_id: userId,
      details: { tenantId, role },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("ROLE UPDATE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * DELETE /api/users/:id
 */
router.delete("/:id", async (req, res) => {
  const tenantId = req.tenantId;
  const userId = Number(req.params.id);

  try {
    // prevent deleting last owner
    const [[m]] = await db.query(
      `
      SELECT role FROM tenant_members
      WHERE tenant_id=? AND user_id=?
      `,
      [tenantId, userId]
    );

    if (m?.role === "owner") {
      const [[count]] = await db.query(
        `
        SELECT COUNT(*) AS c
        FROM tenant_members
        WHERE tenant_id=? AND role='owner'
        `,
        [tenantId]
      );

      if (count?.c <= 1) {
        return res.status(400).json({ message: "Cannot remove last owner" });
      }
    }

    const [r] = await db.query(
      `DELETE FROM tenant_members WHERE tenant_id=? AND user_id=?`,
      [tenantId, userId]
    );

    if (!r.affectedRows) {
      return res.status(404).json({ message: "Member not found" });
    }

    await logAudit(req, {
      action: "TENANT_MEMBER_REMOVE",
      entity_type: "tenant_member",
      entity_id: userId,
      details: { tenantId },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("USER REMOVE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
