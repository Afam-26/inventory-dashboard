// routes/users.js
import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Only tenant admins / owners
router.use(requireAuth, requireTenant, requireRole("owner", "admin"));

function actorUserId(req) {
  // Adjust if your auth middleware stores it differently
  return Number(req.user?.id || req.auth?.id || req.userId || 0);
}

async function getMember(tenantId, userId, conn = db) {
  const [[m]] = await conn.query(
    `SELECT role, status, deactivated_at FROM tenant_members WHERE tenant_id=? AND user_id=? LIMIT 1`,
    [tenantId, userId]
  );
  return m || null;
}

async function ownerCount(tenantId, conn = db) {
  const [[c]] = await conn.query(
    `SELECT COUNT(*) AS c FROM tenant_members WHERE tenant_id=? AND role='owner' AND deactivated_at IS NULL`,
    [tenantId]
  );
  return Number(c?.c || 0);
}

/**
 * GET /api/users
 * includes deactivated_at + deactivated_by
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
        tm.created_at,
        tm.deactivated_at,
        tm.deactivated_by,
        CASE
          WHEN tm.deactivated_at IS NULL THEN 'active'
          ELSE 'deactivated'
        END AS member_state
      FROM tenant_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.tenant_id=?
      ORDER BY tm.role='owner' DESC, (tm.deactivated_at IS NOT NULL) ASC, u.id DESC
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
 * Create user OR add to tenant
 * If they were deactivated, re-activate them
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

    const [[u]] = await conn.query("SELECT id FROM users WHERE email=? LIMIT 1", [email]);
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

      await logAudit(
        req,
        {
          action: "USER_CREATE",
          entity_type: "user",
          entity_id: userId,
          details: { email },
        },
        { db: conn }
      );
    }

    // Upsert member; set active status, clear deactivated flags
    await conn.query(
      `
      INSERT INTO tenant_members (tenant_id,user_id,role,status,created_at,deactivated_at,deactivated_by)
      VALUES (?,?,?,'active',NOW(),NULL,NULL)
      ON DUPLICATE KEY UPDATE
        role=VALUES(role),
        status='active',
        deactivated_at=NULL,
        deactivated_by=NULL
      `,
      [tenantId, userId, role]
    );

    await logAudit(
      req,
      {
        action: "TENANT_MEMBER_UPSERT",
        entity_type: "tenant_member",
        entity_id: userId,
        details: { tenantId, role },
      },
      { db: conn }
    );

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
    const member = await getMember(tenantId, userId);
    if (!member) return res.status(404).json({ message: "Member not found" });

    if (member.deactivated_at) {
      return res.status(400).json({ message: "Cannot change role of a deactivated user. Restore first." });
    }

    // prevent removing last owner
    if (member.role === "owner" && role !== "owner") {
      const owners = await ownerCount(tenantId);
      if (owners <= 1) return res.status(400).json({ message: "Tenant must have at least one owner" });
    }

    const [r] = await db.query(
      `UPDATE tenant_members SET role=? WHERE tenant_id=? AND user_id=?`,
      [role, tenantId, userId]
    );

    if (!r.affectedRows) return res.status(404).json({ message: "Member not found" });

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
 * POST /api/users/:id/deactivate
 * Soft deactivate (does NOT touch status enum)
 * Rules:
 * - cannot deactivate yourself
 * - owner cannot be deactivated
 */
router.post("/:id/deactivate", async (req, res) => {
  const tenantId = req.tenantId;
  const targetUserId = Number(req.params.id);
  const actorId = actorUserId(req);

  if (!targetUserId) return res.status(400).json({ message: "Invalid user id" });
  if (actorId && targetUserId === actorId) {
    return res.status(400).json({ message: "You cannot deactivate yourself" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const member = await getMember(tenantId, targetUserId, conn);
    if (!member) {
      await conn.rollback();
      return res.status(404).json({ message: "Member not found" });
    }

    if (member.role === "owner") {
      await conn.rollback();
      return res.status(400).json({ message: "Owner cannot be deactivated" });
    }

    if (member.deactivated_at) {
      await conn.rollback();
      return res.json({ ok: true, message: "Already deactivated" });
    }

    const [r] = await conn.query(
      `
      UPDATE tenant_members
      SET deactivated_at=NOW(), deactivated_by=?
      WHERE tenant_id=? AND user_id=? AND deactivated_at IS NULL
      `,
      [actorId || null, tenantId, targetUserId]
    );

    if (!r.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ message: "Member not found" });
    }

    await logAudit(
      req,
      {
        action: "TENANT_MEMBER_DEACTIVATE",
        entity_type: "tenant_member",
        entity_id: targetUserId,
        details: { tenantId, by: actorId || null },
      },
      { db: conn }
    );

    await conn.commit();
    res.json({ ok: true, message: "User deactivated" });
  } catch (err) {
    await conn.rollback();
    console.error("DEACTIVATE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/users/:id/restore
 * Restore access (does NOT touch status enum)
 */
router.post("/:id/restore", async (req, res) => {
  const tenantId = req.tenantId;
  const targetUserId = Number(req.params.id);
  const actorId = actorUserId(req);

  if (!targetUserId) return res.status(400).json({ message: "Invalid user id" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const member = await getMember(tenantId, targetUserId, conn);
    if (!member) {
      await conn.rollback();
      return res.status(404).json({ message: "Member not found" });
    }

    if (!member.deactivated_at) {
      await conn.rollback();
      return res.json({ ok: true, message: "Already active" });
    }

    const [r] = await conn.query(
      `
      UPDATE tenant_members
      SET deactivated_at=NULL, deactivated_by=NULL
      WHERE tenant_id=? AND user_id=?
      `,
      [tenantId, targetUserId]
    );

    if (!r.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ message: "Member not found" });
    }

    await logAudit(
      req,
      {
        action: "TENANT_MEMBER_RESTORE",
        entity_type: "tenant_member",
        entity_id: targetUserId,
        details: { tenantId, by: actorId || null },
      },
      { db: conn }
    );

    await conn.commit();
    res.json({ ok: true, message: "User restored" });
  } catch (err) {
    await conn.rollback();
    console.error("RESTORE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});

/**
 * POST /api/users/bulk-deactivate
 * body: { userIds: number[] }
 */
router.post("/bulk-deactivate", async (req, res) => {
  const tenantId = req.tenantId;
  const actorId = actorUserId(req);

  const userIdsRaw = req.body?.userIds;
  const userIds = Array.isArray(userIdsRaw)
    ? [...new Set(userIdsRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))]
    : [];

  if (!userIds.length) return res.status(400).json({ message: "userIds required" });

  if (actorId && userIds.includes(actorId)) {
    return res.status(400).json({ message: "You cannot deactivate yourself" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [members] = await conn.query(
      `
      SELECT user_id, role, deactivated_at
      FROM tenant_members
      WHERE tenant_id=? AND user_id IN (${userIds.map(() => "?").join(",")})
      `,
      [tenantId, ...userIds]
    );

    if (!members.length) {
      await conn.rollback();
      return res.status(404).json({ message: "No matching members found" });
    }

    const ownerHit = members.find((m) => String(m.role).toLowerCase() === "owner");
    if (ownerHit) {
      await conn.rollback();
      return res.status(400).json({ message: `Owner cannot be deactivated (user_id=${ownerHit.user_id})` });
    }

    const [r] = await conn.query(
      `
      UPDATE tenant_members
      SET deactivated_at=NOW(), deactivated_by=?
      WHERE tenant_id=? AND user_id IN (${userIds.map(() => "?").join(",")})
        AND deactivated_at IS NULL
      `,
      [actorId || null, tenantId, ...userIds]
    );

    await logAudit(
      req,
      {
        action: "TENANT_MEMBER_BULK_DEACTIVATE",
        entity_type: "tenant_member",
        entity_id: 0,
        details: { tenantId, count: r.affectedRows, userIds },
      },
      { db: conn }
    );

    await conn.commit();
    res.json({ ok: true, message: `Deactivated ${r.affectedRows} user(s)` });
  } catch (err) {
    await conn.rollback();
    console.error("BULK DEACTIVATE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});

/**
 * DELETE /api/users/:id/hard
 * Permanently remove from tenant_members (cannot be undone)
 * Rules:
 * - owner cannot be removed
 * - cannot delete yourself
 */
router.delete("/:id/hard", async (req, res) => {
  const tenantId = req.tenantId;
  const targetUserId = Number(req.params.id);
  const actorId = actorUserId(req);

  if (!targetUserId) return res.status(400).json({ message: "Invalid user id" });
  if (actorId && targetUserId === actorId) {
    return res.status(400).json({ message: "You cannot delete yourself" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const member = await getMember(tenantId, targetUserId, conn);
    if (!member) {
      await conn.rollback();
      return res.status(404).json({ message: "Member not found" });
    }

    // safety: owner cannot be removed
    if (member.role === "owner") {
      await conn.rollback();
      return res.status(400).json({ message: "Owner cannot be removed" });
    }

    // optional: only allow hard delete if already deactivated
    if (!member.deactivated_at) {
      await conn.rollback();
      return res.status(400).json({ message: "Deactivate the user before permanent delete" });
    }

    const [r] = await conn.query(
      `DELETE FROM tenant_members WHERE tenant_id=? AND user_id=?`,
      [tenantId, targetUserId]
    );

    if (!r.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ message: "Member not found" });
    }

    await logAudit(
      req,
      {
        action: "TENANT_MEMBER_HARD_DELETE",
        entity_type: "tenant_member",
        entity_id: targetUserId,
        details: { tenantId, by: actorId || null },
      },
      { db: conn }
    );

    await conn.commit();
    res.json({ ok: true, message: "User permanently removed" });
  } catch (err) {
    await conn.rollback();
    console.error("HARD DELETE ERROR:", err);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});

export default router;