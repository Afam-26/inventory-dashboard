// routes/tenants.js
import express from "express";
import crypto from "crypto";
import { db } from "../config/db.js";
import { requireAuth, requireTenant, requireRole } from "../middleware/auth.js";
import { logAudit, SEVERITY } from "../utils/audit.js";
import { sendEmail } from "../utils/mailer.js";

const router = express.Router();

async function safeAudit(req, entry) {
  try {
    await logAudit(req, entry);
  } catch (e) {
    console.error("AUDIT FAILED (ignored):", e?.message || e);
  }
}

function sha256hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * POST /api/tenants
 * Create a tenant and add current user as owner
 * Body: { name, slug? }
 */
router.post("/", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const email = req.user.email;

  const name = String(req.body?.name || "").trim();
  let slug = String(req.body?.slug || "").trim().toLowerCase();

  if (!name) return res.status(400).json({ message: "name required" });

  if (!slug) {
    slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [tres] = await conn.query(
      `INSERT INTO tenants (name, slug, status, created_at)
       VALUES (?, ?, 'active', NOW())`,
      [name, slug]
    );

    const tenantId = tres.insertId;

    await conn.query(
      `INSERT INTO tenant_members (tenant_id, user_id, role, status, created_at)
       VALUES (?, ?, 'owner', 'active', NOW())
       ON DUPLICATE KEY UPDATE role='owner', status='active'`,
      [tenantId, userId]
    );

    await conn.commit();

    await safeAudit(req, {
      action: "TENANT_CREATE",
      entity_type: "tenant",
      entity_id: tenantId,
      details: { name, slug },
      user_id: userId,
      user_email: email,
      severity: SEVERITY.INFO,
    });

    res.status(201).json({ ok: true, tenantId, name, slug });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error("TENANT CREATE ERROR:", e);
    res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});

/**
 * GET /api/tenants/current
 * Tenant-scoped. Returns branding and basic tenant info.
 */
router.get("/current", requireAuth, requireTenant, async (req, res) => {
  const tenantId = req.tenantId;

  try {
    const [[t]] = await db.query(
      `SELECT id, name, slug, plan_key, status, logo_url, primary_color, accent_color
       FROM tenants WHERE id=? LIMIT 1`,
      [tenantId]
    );

    if (!t) return res.status(404).json({ message: "Tenant not found" });

    res.json({ tenant: t });
  } catch (e) {
    console.error("TENANT CURRENT ERROR:", e);
    res.status(500).json({ message: "Database error" });
  }
});

/**
 * PATCH /api/tenants/current/branding
 * Body: { name?, logo_url?, primary_color?, accent_color? }
 */
router.patch(
  "/current/branding",
  requireAuth,
  requireTenant,
  requireRole("owner", "admin"),
  async (req, res) => {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const email = req.user.email;

    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    const logo_url =
      req.body?.logo_url != null ? String(req.body.logo_url).trim() : null;
    const primary_color =
      req.body?.primary_color != null ? String(req.body.primary_color).trim() : null;
    const accent_color =
      req.body?.accent_color != null ? String(req.body.accent_color).trim() : null;

    try {
      await db.query(
        `UPDATE tenants
         SET
           name = COALESCE(?, name),
           logo_url = COALESCE(?, logo_url),
           primary_color = COALESCE(?, primary_color),
           accent_color = COALESCE(?, accent_color)
         WHERE id=?`,
        [name, logo_url, primary_color, accent_color, tenantId]
      );

      await safeAudit(req, {
        action: "TENANT_BRANDING_UPDATE",
        entity_type: "tenant",
        entity_id: tenantId,
        details: { name, logo_url, primary_color, accent_color },
        user_id: userId,
        user_email: email,
        severity: SEVERITY.INFO,
      });

      res.json({ ok: true });
    } catch (e) {
      console.error("TENANT BRANDING UPDATE ERROR:", e);
      res.status(500).json({ message: "Database error" });
    }
  }
);

/**
 * POST /api/tenants/current/invite
 * Body: { email, role }
 * Creates an invite and emails link
 */
router.post(
  "/current/invite",
  requireAuth,
  requireTenant,
  requireRole("owner", "admin"),
  async (req, res) => {
    const tenantId = req.tenantId;
    const inviterId = req.user.id;

    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "staff").trim().toLowerCase();

    if (!email) return res.status(400).json({ message: "email required" });
    if (!["owner", "admin", "staff"].includes(role)) {
      return res.status(400).json({ message: "role must be owner, admin, or staff" });
    }

    try {
      // If already a member -> just activate and role update
      const [[existingUser]] = await db.query(
        "SELECT id FROM users WHERE email=? LIMIT 1",
        [email]
      );

      if (existingUser?.id) {
        await db.query(
          `INSERT INTO tenant_members (tenant_id, user_id, role, status, created_at)
           VALUES (?, ?, ?, 'active', NOW())
           ON DUPLICATE KEY UPDATE role=VALUES(role), status='active'`,
          [tenantId, existingUser.id, role]
        );

        return res.json({ ok: true, mode: "existing_user_added", email, role });
      }

      const raw = makeToken();
      const token_hash = sha256hex(raw);

      await db.query(
        `INSERT INTO tenant_invitations
           (tenant_id, email, role, token_hash, expires_at, created_by_user_id)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?)`,
        [tenantId, email, role, token_hash, inviterId]
      );

      const front =
        process.env.FRONTEND_URL || "http://localhost:5173";
      const link = `${front}/accept-invite?token=${raw}&email=${encodeURIComponent(
        email
      )}`;

      // Email (safe in dev: optionally return link)
      try {
        await sendEmail({
          to: email,
          subject: "You're invited",
          text: `You have been invited. Accept here: ${link}`,
          html: `<p>You have been invited.</p><p><a href="${link}">Accept invite</a></p>`,
        });
      } catch (e) {
        console.error("INVITE EMAIL FAILED:", e?.message || e);
      }

      res.json({
        ok: true,
        mode: "invited",
        email,
        role,
        ...(process.env.RETURN_DEV_INVITE_LINK === "true"
          ? { dev_invite_link: link }
          : {}),
      });
    } catch (e) {
      console.error("INVITE ERROR:", e);
      res.status(500).json({ message: "Database error" });
    }
  }
);

export default router;
