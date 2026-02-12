// routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { db } from "../config/db.js";
import { sendEmail } from "../services/mail/mailer.js";
import { passwordResetEmail } from "../services/mail/emailTemplates.js";
import { logAudit, sendSecurityAlert, SEVERITY } from "../utils/audit.js";

const router = express.Router();
const isProd = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

function makeSlug(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ✅ SIGNUP: creates user + tenant + membership, returns TENANT token (so app works immediately)
router.post("/register", async (req, res) => {
  const full_name = String(req.body?.full_name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const tenantName = String(req.body?.tenantName || "").trim();
  const planKey = String(req.body?.planKey || "starter").trim().toLowerCase();

  if (!full_name) return res.status(400).json({ message: "Full name is required" });
  if (!email) return res.status(400).json({ message: "Email is required" });
  if (!password || password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }
  if (!tenantName) return res.status(400).json({ message: "Workspace name is required" });
  if (!["starter", "pro", "business"].includes(planKey)) {
    return res.status(400).json({ message: "Invalid plan" });
  }

  // Railway has enum('admin','staff') for users.role.
  // Local has varchar. Use "admin" so it works in BOTH.
  const globalUserRole = "admin";

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Prevent duplicate email
    const [[exists]] = await conn.query("SELECT id FROM users WHERE email=? LIMIT 1", [email]);
    if (exists?.id) {
      await conn.rollback();
      return res.status(409).json({ message: "Email already exists" });
    }

    // 2) Insert user (supports Railway users.is_active and local without it)
    const hashed = await bcrypt.hash(password, 10);

    const [isActiveCols] = await conn.query("SHOW COLUMNS FROM users LIKE 'is_active'");
    const hasIsActive = (isActiveCols || []).length > 0;

    let uRes;
    if (hasIsActive) {
      // Railway schema
      [uRes] = await conn.query(
        `
        INSERT INTO users (email, password_hash, role, full_name, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, NOW())
        `,
        [email, hashed, globalUserRole, full_name]
      );
    } else {
      // Local schema
      [uRes] = await conn.query(
        `
        INSERT INTO users (email, password_hash, role, full_name, created_at)
        VALUES (?, ?, ?, ?, NOW())
        `,
        [email, hashed, globalUserRole, full_name]
      );
    }

    const userId = uRes.insertId;

    // 3) Create tenant (slug best-effort unique)
    let slug = makeSlug(tenantName);
    if (!slug) slug = `workspace-${userId}`;

    // if slug already exists, append random suffix
    const [[slugHit]] = await conn.query("SELECT id FROM tenants WHERE slug=? LIMIT 1", [slug]);
    if (slugHit?.id) slug = `${slug}-${String(Date.now()).slice(-6)}`;

    const [tRes] = await conn.query(
      `
      INSERT INTO tenants (name, slug, plan_key, status, created_at)
      VALUES (?, ?, ?, 'active', NOW())
      `,
      [tenantName, slug, planKey]
    );

    const tenantId = tRes.insertId;

    // 4) Add membership (real permissions live here)
    await conn.query(
      `
      INSERT INTO tenant_members (tenant_id, user_id, role, status, created_at)
      VALUES (?, ?, 'owner', 'active', NOW())
      `,
      [tenantId, userId]
    );

    await conn.commit();

    // ✅ Return a TENANT token so the app doesn't say "No tenant selected"
    const token = signTenantToken({
      id: userId,
      email,
      tenantId,
      tenantRole: "owner",
    });

    const tenants = [{ id: tenantId, name: tenantName, slug, role: "owner" }];

    // audit best-effort
    try {
      await logAudit(
        {
          ...req,
          user: { id: userId, email },
          tenantId,
        },
        {
          action: "SIGNUP",
          entity_type: "auth",
          entity_id: userId,
          details: { tenantId, tenantName, planKey },
          user_id: userId,
          user_email: email,
          severity: SEVERITY.INFO,
        }
      );
    } catch {}

    return res.status(201).json({
      token,
      tenantId,
      role: "owner",
      user: { id: userId, email, role: globalUserRole, full_name },
      tenants,
    });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    console.error("REGISTER ERROR:", e);
    return res.status(500).json({ message: "Database error" });
  } finally {
    conn.release();
  }
});


function signUserToken(user) {
  // user-token (tenant not selected yet)
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role, // global user role from users table
      tenantId: null,
    },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function signTenantToken({ id, email, tenantId, tenantRole }) {
  // tenant-token (tenant selected)
  return jwt.sign(
    {
      id,
      email,
      role: String(tenantRole || "").toLowerCase(), // owner/admin/staff
      tenantId: Number(tenantId),
    },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function makeRefreshToken() {
  return crypto.randomBytes(48).toString("hex");
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

async function safeSecurityAlert(payload) {
  try {
    await sendSecurityAlert(db, payload);
  } catch (e) {
    console.error("SECURITY ALERT FAILED (ignored):", e?.message || e);
  }
}

async function safeAudit(req, entry) {
  try {
    await logAudit(req, entry);
  } catch (e) {
    console.error("AUDIT FAILED (ignored):", e?.message || e);
  }
}

function readBearerPayload(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { ok: false, status: 401, message: "Missing token" };

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.id) return { ok: false, status: 401, message: "Invalid token" };
    return { ok: true, payload };
  } catch {
    return { ok: false, status: 401, message: "Invalid token" };
  }
}

/**
 * tenant_members schema:
 * - tenant_id
 * - user_id
 * - role (owner/admin/staff)
 */
async function getUserTenants(userId) {
  const [rows] = await db.query(
    `
    SELECT
      t.id,
      t.name,
      t.slug,
      tm.role
    FROM tenant_members tm
    JOIN tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = ?
      AND tm.status = 'active'
    ORDER BY t.name ASC
    `,
    [userId]
  );
  return rows;
}

const loginLimiter = rateLimit({
  windowMs: isProd ? 5 * 60 * 1000 : 10 * 1000,
  max: isProd ? 15 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again shortly." },
});

const refreshLimiter = rateLimit({
  windowMs: isProd ? 5 * 60 * 1000 : 60 * 1000,
  max: isProd ? 60 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many refresh attempts. Try again shortly." },
});

const resetLimiter = rateLimit({
  windowMs: isProd ? 10 * 60 * 1000 : 60 * 1000,
  max: isProd ? 10 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Try again shortly." },
});

/**
 * POST /api/auth/login
 * Returns:
 *  - token (user-token, tenantId=null)
 *  - user
 *  - tenants (from tenant_members)
 */
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = String(email || "").trim().toLowerCase();

    if (!cleanEmail || !password) {
      await safeAudit(req, {
        action: "LOGIN_FAILED",
        entity_type: "user",
        entity_id: null,
        details: { email: cleanEmail || null, reason: "MISSING_FIELDS" },
        user_id: null,
        user_email: cleanEmail || null,
        severity: SEVERITY.WARN,
      });
      return res.status(400).json({ message: "Email and password required" });
    }

    const [rows] = await db.query(
      "SELECT id, full_name, email, password_hash, role FROM users WHERE email=? LIMIT 1",
      [cleanEmail]
    );

    const user = rows[0];
    if (!user) {
      await safeAudit(req, {
        action: "LOGIN_FAILED",
        entity_type: "user",
        entity_id: null,
        details: { email: cleanEmail, reason: "INVALID_CREDENTIALS" },
        user_id: null,
        user_email: cleanEmail,
        severity: SEVERITY.WARN,
      });

      await safeSecurityAlert({
        severity: SEVERITY.WARN,
        subject: "Login failed (unknown email)",
        text: `Login failed for unknown email ${cleanEmail} from IP ${req.ip}`,
        html: `<p><b>Login failed (unknown email)</b></p><p>Email: ${cleanEmail}</p><p>IP: ${req.ip}</p>`,
      });

      return res.status(401).json({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await safeAudit(req, {
        action: "LOGIN_FAILED",
        entity_type: "user",
        entity_id: user.id,
        details: { email: user.email, reason: "INVALID_CREDENTIALS" },
        user_id: user.id,
        user_email: user.email,
        severity: SEVERITY.WARN,
      });

      await safeSecurityAlert({
        severity: SEVERITY.WARN,
        subject: "Login failed (bad password)",
        text: `Login failed for ${user.email} from IP ${req.ip}`,
        html: `<p><b>Login failed (bad password)</b></p><p>User: ${user.email}</p><p>IP: ${req.ip}</p>`,
      });

      return res.status(401).json({ message: "Invalid credentials" });
    }

    const accessToken = signUserToken(user);

    const refreshToken = makeRefreshToken();
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [user.id, refreshToken]
    );

    res.cookie("refresh_token", refreshToken, refreshCookieOptions());

    await safeAudit(req, {
      action: "LOGIN",
      entity_type: "user",
      entity_id: user.id,
      details: { email: user.email, role: user.role, success: true },
      user_id: user.id,
      user_email: user.email,
      severity: SEVERITY.INFO,
    });

    let tenants = [];
    try {
      tenants = await getUserTenants(user.id);
    } catch (e) {
      console.error("FETCH TENANTS ON LOGIN FAILED:", e?.message || e);
      tenants = [];
    }

    return res.json({
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
      },
      tenants,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err?.code, err?.message);

    if (err?.code === "ETIMEDOUT" || err?.code === "ECONNREFUSED") {
      return res.status(503).json({
        message: "Service temporarily unavailable. Please try again.",
      });
    }

    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/auth/tenants
 * Requires bearer token (user-token or tenant-token)
 */
router.get("/tenants", async (req, res) => {
  try {
    const r = readBearerPayload(req);
    if (!r.ok) return res.status(r.status).json({ message: r.message });

    const tenants = await getUserTenants(r.payload.id);
    return res.json({ tenants });
  } catch (err) {
    console.error("AUTH TENANTS ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/select-tenant
 * Body: { tenantId }
 * Requires bearer token
 * Returns: { token, tenantId, role }
 */
router.post("/select-tenant", async (req, res) => {
  try {
    const r = readBearerPayload(req);
    if (!r.ok) return res.status(r.status).json({ message: r.message });

    const userId = r.payload.id;

    // ensure we have email
    let email = r.payload.email;
    if (!email) {
      const [[u]] = await db.query("SELECT email FROM users WHERE id=? LIMIT 1", [userId]);
      email = u?.email || null;
    }

    const tenantId = Number(req.body?.tenantId);
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
      return res.status(400).json({ message: "tenantId is required" });
    }

    const [[m]] = await db.query(
      "SELECT role, status FROM tenant_members WHERE user_id=? AND tenant_id=? LIMIT 1",
      [userId, tenantId]
    );

    if (!m) return res.status(403).json({ message: "Not a member of this tenant" });
    if (String(m.status || "active") !== "active") {
      return res.status(403).json({ message: "Tenant membership is not active" });
    }

    const tenantRole = String(m.role || "").toLowerCase();

    const tenantToken = signTenantToken({
      id: userId,
      email,
      tenantId,
      tenantRole,
    });

    await safeAudit(req, {
      action: "TENANT_SELECTED",
      entity_type: "tenant",
      entity_id: tenantId,
      details: { tenantId, role: tenantRole },
      user_id: userId,
      user_email: email,
      severity: SEVERITY.INFO,
    });

    return res.json({ token: tenantToken, tenantId: Number(tenantId), role: tenantRole });
  } catch (err) {
    console.error("SELECT TENANT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/refresh
 * If header x-tenant-id is present and user is member, returns tenant-token.
 * else returns user-token.
 */
router.post("/refresh", refreshLimiter, async (req, res) => {
  try {
    const rt = req.cookies?.refresh_token;
    if (!rt) {
      await safeAudit(req, {
        action: "REFRESH_FAILED",
        entity_type: "auth",
        entity_id: null,
        details: { reason: "MISSING_REFRESH_COOKIE" },
        severity: SEVERITY.WARN,
      });
      return res.status(401).json({ message: "Missing refresh token" });
    }

    const [rows] = await db.query(
      `SELECT user_id, expires_at, revoked_at
       FROM refresh_tokens
       WHERE token = ? LIMIT 1`,
      [rt]
    );

    const row = rows[0];
    if (!row || row.revoked_at) {
      await safeAudit(req, {
        action: "REFRESH_FAILED",
        entity_type: "auth",
        entity_id: null,
        details: { reason: "INVALID_OR_REVOKED_REFRESH_TOKEN" },
        severity: SEVERITY.CRITICAL,
      });

      await safeSecurityAlert({
        severity: SEVERITY.CRITICAL,
        subject: "Refresh token rejected (possible session hijack)",
        text: `Refresh rejected from IP ${req.ip} (revoked/invalid token).`,
        html: `<p><b>Refresh token rejected</b></p><p>Reason: revoked/invalid</p><p>IP: ${req.ip}</p>`,
      });

      return res.status(401).json({ message: "Invalid refresh token" });
    }

    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() > expiresAt) {
      await safeAudit(req, {
        action: "REFRESH_FAILED",
        entity_type: "auth",
        entity_id: null,
        details: { reason: "REFRESH_TOKEN_EXPIRED", user_id: row.user_id },
        user_id: row.user_id,
        severity: SEVERITY.WARN,
      });
      return res.status(401).json({ message: "Refresh token expired" });
    }

    const [users] = await db.query(
      "SELECT id, full_name, email, role FROM users WHERE id=? LIMIT 1",
      [row.user_id]
    );

    const user = users[0];
    if (!user) return res.status(401).json({ message: "User not found" });

    const requestedTenantId = Number(req.headers["x-tenant-id"] || 0);

    let newAccessToken = signUserToken(user);
    let tenantIdUsed = null;

    if (Number.isFinite(requestedTenantId) && requestedTenantId > 0) {
      const [[m]] = await db.query(
        "SELECT role, status FROM tenant_members WHERE user_id=? AND tenant_id=? LIMIT 1",
        [user.id, requestedTenantId]
      );

      if (m?.role && String(m.status || "active") === "active") {
        newAccessToken = signTenantToken({
          id: user.id,
          email: user.email,
          tenantId: requestedTenantId,
          tenantRole: String(m.role || "").toLowerCase(),
        });
        tenantIdUsed = requestedTenantId;
      }
    }

    await safeAudit(req, {
      action: "REFRESH",
      entity_type: "auth",
      entity_id: user.id,
      details: { success: true, tenantId: tenantIdUsed },
      user_id: user.id,
      user_email: user.email,
      severity: SEVERITY.INFO,
    });

    return res.json({
      token: newAccessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
      },
    });
  } catch (err) {
    console.error("REFRESH ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", async (req, res) => {
  try {
    const rt = req.cookies?.refresh_token;

    let userId = null;
    let userEmail = null;

    if (rt) {
      const [[r]] = await db.query("SELECT user_id FROM refresh_tokens WHERE token=? LIMIT 1", [rt]);
      userId = r?.user_id ?? null;

      if (userId) {
        const [[u]] = await db.query("SELECT email FROM users WHERE id=? LIMIT 1", [userId]);
        userEmail = u?.email ?? null;
      }

      await db.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE token=?", [rt]);
    }

    res.clearCookie("refresh_token", { ...refreshCookieOptions(), maxAge: 0 });

    await safeAudit(req, {
      action: "LOGOUT",
      entity_type: "auth",
      entity_id: userId,
      details: { success: true },
      user_id: userId,
      user_email: userEmail,
      severity: SEVERITY.INFO,
    });

    return res.json({ message: "Logged out" });
  } catch (err) {
    console.error("LOGOUT ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/forgot-password
 */
router.post("/forgot-password", resetLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ message: "Email required" });

    const normalized = email.trim().toLowerCase();

    let emailStatus = "not_sent";
    let emailError = null;

    const [rows] = await db.query("SELECT id, email FROM users WHERE email=? LIMIT 1", [normalized]);

    if (!rows.length) {
      await safeAudit(req, {
        action: "PASSWORD_RESET_REQUEST",
        entity_type: "user",
        entity_id: null,
        details: { email: normalized, outcome: "EMAIL_NOT_FOUND" },
        user_id: null,
        user_email: normalized,
        severity: SEVERITY.INFO,
      });

      return res.json({
        message: "If the email exists, a reset link was sent.",
        ...(!isProd ? { dev_note: "Email not found in users table (no reset created)." } : {}),
      });
    }

    const user = rows[0];

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await db.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      [user.id, tokenHash]
    );

    const front = process.env.FRONTEND_URL || (isProd ? "" : "http://localhost:5173");
    const resetLink = `${front}/reset-password?token=${rawToken}&email=${encodeURIComponent(normalized)}`;

    await safeAudit(req, {
      action: "PASSWORD_RESET_REQUEST",
      entity_type: "user",
      entity_id: user.id,
      details: { email: normalized, created: true },
      user_id: user.id,
      user_email: normalized,
      severity: SEVERITY.INFO,
    });

    try {
      const { subject, html, text } = passwordResetEmail({ resetLink, minutes: 30 });
      await sendEmail({ to: normalized, subject, html, text });
      emailStatus = "sent";
    } catch (mailErr) {
      emailStatus = "failed";
      emailError = mailErr?.message || String(mailErr);
      console.error("EMAIL SEND ERROR:", emailError);

      await safeAudit(req, {
        action: "PASSWORD_RESET_EMAIL_FAILED",
        entity_type: "user",
        entity_id: user.id,
        details: { email: normalized, error: emailError },
        user_id: user.id,
        user_email: normalized,
        severity: SEVERITY.WARN,
      });

      if (isProd) {
        await safeSecurityAlert({
          severity: SEVERITY.WARN,
          subject: "Password reset email failed",
          text: `Reset email failed for ${normalized} (IP ${req.ip}). Error: ${emailError}`,
          html: `<p><b>Password reset email failed</b></p><p>User: ${normalized}</p><p>IP: ${req.ip}</p><p>Error: ${emailError}</p>`,
        });
      }
    }

    return res.json({
      message: "If the email exists, a reset link was sent.",
      ...(process.env.RETURN_DEV_RESET_LINK === "true" && !isProd ? { dev_reset_link: resetLink } : {}),
      ...(!isProd ? { emailStatus, emailError } : {}),
    });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/reset-password
 */
router.post("/reset-password", resetLimiter, async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email?.trim() || !token?.trim() || !newPassword) {
      return res.status(400).json({ message: "Email, token and new password are required" });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const normalized = email.trim().toLowerCase();
    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");

    const [urows] = await db.query("SELECT id, email FROM users WHERE email=? LIMIT 1", [normalized]);
    if (!urows.length) return res.status(400).json({ message: "Invalid token" });

    const userId = urows[0].id;

    const [rrows] = await db.query(
      `SELECT id, expires_at, used_at
       FROM password_resets
       WHERE user_id=? AND token_hash=?
       ORDER BY id DESC
       LIMIT 1`,
      [userId, tokenHash]
    );

    if (!rrows.length) return res.status(400).json({ message: "Invalid token" });

    const resetRow = rrows[0];
    if (resetRow.used_at) return res.status(400).json({ message: "Token already used" });

    const expiresAt = new Date(resetRow.expires_at).getTime();
    if (Date.now() > expiresAt) return res.status(400).json({ message: "Token expired" });

    const password_hash = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password_hash=? WHERE id=?", [password_hash, userId]);

    await db.query("UPDATE password_resets SET used_at=NOW() WHERE id=?", [resetRow.id]);
    await db.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL", [userId]);

    await safeAudit(req, {
      action: "PASSWORD_RESET_COMPLETED",
      entity_type: "user",
      entity_id: userId,
      details: { email: normalized, success: true },
      user_id: userId,
      user_email: normalized,
      severity: SEVERITY.WARN,
    });

    await safeSecurityAlert({
      severity: SEVERITY.WARN,
      subject: "Password reset completed",
      text: `Password reset completed for ${normalized} from IP ${req.ip}`,
      html: `<p><b>Password reset completed</b></p><p>User: ${normalized}</p><p>IP: ${req.ip}</p>`,
    });

    return res.json({ message: "Password reset successful. Please login." });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;
