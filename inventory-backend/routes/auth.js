import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { db } from "../config/db.js";
import { logAudit } from "../utils/audit.js";


const router = express.Router();

const isProd = process.env.NODE_ENV === "production";

/**
 * Helpers
 */
function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
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
 * ✅ Rate limiters (DEV vs PROD)
 */
const loginLimiter = rateLimit({
  windowMs: isProd ? 5 * 60 * 1000 : 10 * 1000, // prod 5m, dev 10s
  max: isProd ? 15 : 100, // prod 15 attempts, dev 100
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
 */
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const cleanEmail = email.trim().toLowerCase();

    const [rows] = await db.query(
      "SELECT id, full_name, email, password_hash, role FROM users WHERE email=? LIMIT 1",
      [cleanEmail]
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    // short-lived access token
    const accessToken = signAccessToken(user);

    // long-lived refresh token stored in DB
    const refreshToken = makeRefreshToken();

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [user.id, refreshToken]
    );

    // cookie for refresh
    res.cookie("refresh_token", refreshToken, refreshCookieOptions());
        
    await logAudit(req, {
      action: "LOGIN",
      entity_type: "user",
      entity_id: user.id,
      user_id: user.id,
      user_email: user.email,
      details: { email: user.email, role: user.role },
    });



    res.json({
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/refresh
 * Reads refresh_token from httpOnly cookie
 */
router.post("/refresh", refreshLimiter, async (req, res) => {
  try {
    const rt = req.cookies?.refresh_token; // requires cookie-parser in server.js
    if (!rt) return res.status(401).json({ message: "Missing refresh token" });

    const [rows] = await db.query(
      `SELECT user_id, expires_at, revoked_at
       FROM refresh_tokens
       WHERE token = ? LIMIT 1`,
      [rt]
    );

    const row = rows[0];
    if (!row || row.revoked_at) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() > expiresAt) {
      return res.status(401).json({ message: "Refresh token expired" });
    }

    const [users] = await db.query(
      "SELECT id, full_name, email, role FROM users WHERE id=? LIMIT 1",
      [row.user_id]
    );

    const user = users[0];
    if (!user) return res.status(401).json({ message: "User not found" });

    const newAccess = signAccessToken(user);

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
 * Revokes refresh token + clears cookie
 */
router.post("/logout", async (req, res) => {
  try {
    const rt = req.cookies?.refresh_token;

    if (rt) {
      await db.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE token=?", [rt]);
    }

    res.clearCookie("refresh_token", { ...refreshCookieOptions(), maxAge: 0 });

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

    const [rows] = await db.query("SELECT id, email FROM users WHERE email=? LIMIT 1", [
      normalized,
    ]);

    // prevent user enumeration
    if (!rows.length) return res.json({ message: "If the email exists, a reset link was sent." });

    const user = rows[0];

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await db.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      [user.id, tokenHash]
    );

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(
      normalized
    )}`;

    res.json({
      message: "If the email exists, a reset link was sent.",
      // remove in production:
      dev_reset_link: resetLink,
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

    const [urows] = await db.query("SELECT id FROM users WHERE email=? LIMIT 1", [normalized]);
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

    // revoke all refresh tokens (recommended)
    await db.query(
      "UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL",
      [userId]
    );

    res.json({ message: "Password reset successful. Please login." });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
