// routes/invites.js
import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "../config/db.js";
import { logAudit, SEVERITY } from "../utils/audit.js";

const router = express.Router();

function sha256hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

async function safeAudit(req, entry) {
  try {
    await logAudit(req, entry);
  } catch (e) {
    console.error("AUDIT FAILED (ignored):", e?.message || e);
  }
}

/**
 * POST /api/invites/accept
 * Body: { email, token, full_name, password }
 */
router.post("/accept", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const token = String(req.body?.token || "").trim();
  const full_name = String(req.body?.full_name || "").trim();
  const password = String(req.body?.password || "");

  if (!email || !token) return res.status(400).json({ message: "email and token required" });
  if (!password || password.length < 8) {
    return res.status(400).json({ message: "password required (min 8 chars)" });
  }

  const token_hash = sha256hex(token);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[inv]] = await conn.query(
      `SELECT id, tenant_id, email, role, expires_at, accepted_at
       FROM tenant_invitations
       WHERE token_hash=? LIMIT 1`,
      [token_hash]
    );

    if (!inv) {
      await conn.rollback();
      return res.status(400).json({ message: "Invalid invite token" });
    }
    if (inv.accepted_at) {
      await conn.rollback();
      return res.status(400).json({ message: "Invite already used" });
    }
    if (String(inv.email).toLowerCase() !== email) {
      await conn.rollback();
      return res.status(400).json({ message: "Invite email mismatch" });
    }
    if (Date.now() > new Date(inv.expires_at).getTime()) {
      await conn.rollback();
      return res.status(400).json({ message: "Invite expired" });
    }

    // find or create user
    const [[u]] = await conn.query("SELECT id FROM users WHERE email=? LIMIT 1", [email]);
    let userId = u?.id;

    if (!userId) {
      const hash = await bcrypt.hash(password, 10);
      const [ur] = await conn.query(
        `INSERT INTO users (full_name, email, password_hash, role)
         VALUES (?, ?, ?, 'user')`,
        [full_name || null, email, hash]
      );
      userId = ur.insertId;
    }

    // add membership
    await conn.query(
      `INSERT INTO tenant_members (tenant_id, user_id, role, status, created_at)
       VALUES (?, ?, ?, 'active', NOW())
       ON DUPLICATE KEY UPDATE role=VALUES(role), status='active'`,
      [inv.tenant_id, userId, String(inv.role || "staff").toLowerCase()]
    );

    // mark accepted
    await conn.query("UPDATE tenant_invitations SET accepted_at=NOW() WHERE id=?", [inv.id]);

    await conn.commit();

    await safeAudit(req, {
      action: "INVITE_ACCEPTED",
      entity_type: "tenant",
      entity_id: inv.tenant_id,
      details: { email, role: inv.role },
      user_id: userId,
      user_email: email,
      severity: SEVERITY.INFO,
    });

    res.json({ ok: true, tenantId: inv.tenant_id });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error("INVITE ACCEPT ERROR:", e);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});

export default router;
