// routes/auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { db } from "../config/db.js";
import { sendEmail } from "../utils/mailer.js";
import { passwordResetEmail } from "../utils/emailTemplates.js";
import { logAudit, sendSecurityAlert, SEVERITY } from "../utils/audit.js";

const router = express.Router();

const isProd = process.env.NODE_ENV === "production";

/**
 * Helpers
 */
function signAccessToken(user) {
  // user-token (no tenant selected yet)
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role, // global role from users table
      tenantId: user.tenantId ?? null,
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function signTenantAccessToken({ id, email, tenantId, tenantRole }) {
  // tenant-token (tenant selected)
  return jwt.sign(
    {
      id,
      email,
      role: tenantRole, // tenant role: owner/admin/staff
      tenantId: tenantId,
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function makeRefreshToken() {
  return crypto.randomBytes(48).toString("hex");
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd, // true on Railway/HTTPS
    sameSite: isProd ? "none" : "lax", // cross-site in prod
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };
}

/**
 * ✅ Non-blocking wrapper: security alerts must NEVER break auth flows
 */
async function safeSecurityAlert(payload) {
  try {
    await sendSecurityAlert(db, payload);
  } catch (e) {
    console.error("SECURITY ALERT FAILED (ignored):", e?.message || e);
  }
}

/**
 * ✅ Non-blocking wrapper: audit must NEVER break auth flows
 */
async function safeAudit(req, entry) {
  try {
    await logAudit(req, entry);
  } catch (e) {
    console.error("AUDIT FAILED (ignored):", e?.message || e);
  }
}

/**
 * Read Bearer token payload (for routes that are "auth" routes but still require login)
 */
function readBearerPayload(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { ok: false, status: 401, message: "Missing token" };

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload?.id) return { ok: false, status: 401, message: "Invalid token" };
    return { ok: true, payload };
  } catch {
    return { ok: false, status: 401, message: "Invalid token" };
  }
}

/**
 * Fetch tenants user belongs to
 */
async function getUserTenants(userId) {
  const [rows] = await db.query(
    `
    SELECT
      t.id,
      t.name,
      tu.role
    FROM tenant_users tu
    JOIN tenants t ON t.id = tu.tenant_id
    WHERE tu.user_id = ?
    ORDER BY t.name ASC
    `,
    [userId]
  );
  return rows;
}

/**
 * ✅ Rate limiters (DEV vs PROD)
 */
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
 * Returns user-token + tenants list (so frontend can select one)
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

    // user-token (tenant not selected yet)
    const accessToken = signAccessToken({ ...user, tenantId: null });

    // long-lived refresh token stored in DB
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

    // ✅ include tenant list so UI can select
    let tenants = [];
    try {
      tenants = await getUserTenants(user.id);
    } catch (e) {
      console.error("FETCH TENANTS ON LOGIN FAILED:", e?.message || e);
      tenants = [];
    }

    res.json({
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
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/auth/tenants
 * Returns tenants user belongs to (requires user-token)
 */
router.get("/tenants", async (req, res) => {
  try {
    const r = readBearerPayload(req);
    if (!r.ok) return res.status(r.status).json({ message: r.message });

    const tenants = await getUserTenants(r.payload.id);
    res.json({ tenants });
  } catch (err) {
    console.error("AUTH TENANTS ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/select-tenant
 * Body: { tenantId }
 * Returns tenant-scoped token (tenantId + tenant role)
 */
router.post("/select-tenant", async (req, res) => {
  try {
    const r = readBearerPayload(req);
    if (!r.ok) return res.status(r.status).json({ message: r.message });

    const userId = r.payload.id;
    const email = r.payload.email;

    const tenantId = Number(req.body?.tenantId);
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
      return res.status(400).json({ message: "tenantId is required" });
    }

    const [[m]] = await db.query(
      "SELECT role FROM tenant_users WHERE user_id=? AND tenant_id=? LIMIT 1",
      [userId, tenantId]
    );

    if (!m) return res.status(403).json({ message: "Not a member of this tenant" });

    const tenantRole = String(m.role || "").toLowerCase();

    const tenantToken = signTenantAccessToken({
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

    res.json({ token: tenantToken, tenantId, role: tenantRole });
  } catch (err) {
    console.error("SELECT TENANT ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/refresh
 * Uses refresh_token cookie.
 * If x-tenant-id is present and user is member, returns tenant-scoped token.
 * Otherwise returns user-token (tenantId null).
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
    if (!user) {
      await safeAudit(req, {
        action: "REFRESH_FAILED",
        entity_type: "auth",
        entity_id: null,
        details: { reason: "USER_NOT_FOUND", user_id: row.user_id },
        user_id: row.user_id,
        severity: SEVERITY.WARN,
      });

      return res.status(401).json({ message: "User not found" });
    }

    const requestedTenantId = Number(req.headers["x-tenant-id"] || 0);

    let newAccess;

    if (Number.isFinite(requestedTenantId) && requestedTenantId > 0) {
      const [[m]] = await db.query(
        "SELECT role FROM tenant_users WHERE user_id=? AND tenant_id=? LIMIT 1",
        [user.id, requestedTenantId]
      );

      if (m?.role) {
        newAccess = signTenantAccessToken({
          id: user.id,
          email: user.email,
          tenantId: requestedTenantId,
          tenantRole: String(m.role).toLowerCase(),
        });
      } else {
        // fallback user-token
        newAccess = signAccessToken({ ...user, tenantId: null });
      }
    } else {
      newAccess = signAccessToken({ ...user, tenantId: null });
    }

    await safeAudit(req, {
      action: "REFRESH",
      entity_type: "auth",
      entity_id: user.id,
      details: { success: true, tenantId: requestedTenantId || null },
      user_id: user.id,
      user_email: user.email,
      severity: SEVERITY.INFO,
    });

    res.json({
      token: newAccess,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
      },
    });
  } catch (err) {
    console.error("REFRESH ERROR:", err);
    res.status(500).json({ message: "Server error" });
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

    res.json({ message: "Logged out" });
  } catch (err) {
    console.error("LOGOUT ERROR:", err);
    res.status(500).json({ message: "Server error" });
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

    res.json({
      message: "If the email exists, a reset link was sent.",
      ...(process.env.RETURN_DEV_RESET_LINK === "true" && !isProd ? { dev_reset_link: resetLink } : {}),
      ...(!isProd ? { emailStatus, emailError } : {}),
    });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({ message: "Server error" });
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

    res.json({ message: "Password reset successful. Please login." });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
