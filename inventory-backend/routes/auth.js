import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { db } from "../config/db.js";

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
  // IMPORTANT for Vercel -> Railway cross-site cookies:
  // - sameSite must be "none"
  // - secure must be true in production (HTTPS)
  return {
    httpOnly: true,
    secure: isProd, // true on Railway
    sameSite: isProd ? "none" : "lax", // local dev works with lax
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };
}

/**
 * Rate limiters
 */
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
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

    // Access token (short-lived)
    const accessToken = signAccessToken(user);

    // Refresh token (long-lived, stored in DB)
    const refreshToken = makeRefreshToken();

    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [user.id, refreshToken]
    );

    // Set refresh token cookie
    res.cookie("refresh_token", refreshToken, refreshCookieOptions());

    res.json({
      token: accessToken,
      user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/auth/refresh
 * Uses httpOnly cookie refresh_token
 */
router.post("/refresh", refreshLimiter, async (req, res) => {
  try {
    const rt = req.cookies?.refresh_token;
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

    // Issue new access token
    const newAccess = signAccessToken(user);

    res.json({
      token: newAccess,
      user: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
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

    res.clearCookie("refresh_token", {
      ...refreshCookieOptions(),
      maxAge: 0,
    });

    res.json({ message: "Logged out" });
  } catch (err) {
    console.error("LOGOUT ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
