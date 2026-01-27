// server.js
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ensures .env is loaded even if you start node from another folder
dotenv.config({ path: path.join(__dirname, ".env") });

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";

import { db } from "./config/db.js";

import productsRoutes from "./routes/products.js";
import categoriesRoutes from "./routes/categories.js";
import dashboardRoutes from "./routes/dashboard.js";
import stockRoutes from "./routes/stock.js";
import authRoutes from "./routes/auth.js";
import auditRoutes from "./routes/audit.js";
import usersRoutes from "./routes/users.js";
import tenantsRouter from "./routes/tenants.js";
import healthRoutes from "./routes/health.js";

import { scheduleDailySnapshots } from "./utils/auditSnapshots.js";

const app = express();

/**
 * Behind Railway/Proxies:
 * needed for correct IP + rate-limit behavior
 */
app.set("trust proxy", 1);

/**
 * Hide Express signature
 */
app.disable("x-powered-by");

/**
 * ✅ Helmet (security headers)
 * - Keep CSP off unless configured (can break apps)
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ✅ Allowed frontend origins
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://inventory-dashboard-omega-five.vercel.app",
];

app.use(
  cors({
    origin(origin, callback) {
      // allow server-to-server / curl / Railway health checks
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      console.error("❌ Blocked by CORS:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-tenant-id"],
    exposedHeaders: ["Authorization", "Set-Cookie"],
  })
);




/**
 * ✅ Body + cookies
 */
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

/**
 * ✅ Rate limit (global /api)
 * Skip OPTIONS so preflight never gets blocked.
 */
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
});
app.use("/api", apiLimiter);

/**
 * Health
 */
app.get("/", (req, res) => res.send("Inventory API running ✅"));

/**
 * Routes
 */
app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/tenants", tenantsRouter);
app.use("/api/health", healthRoutes);

// ✅ mount same router for admin paths (for dashboard verify button)
app.use("/api/admin/audit", auditRoutes);

// start scheduler once
scheduleDailySnapshots(db, { hourUtc: 0, minuteUtc: 5 });

/**
 * ✅ Audit retention job (auto-purge)
 */
function startAuditRetentionJob() {
  const days = Number(process.env.AUDIT_RETENTION_DAYS || 90);

  if (!days || days < 1) {
    console.log("Audit retention disabled (AUDIT_RETENTION_DAYS not set or invalid).");
    return;
  }

  async function purge() {
    try {
      const [result] = await db.query(
        `DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [days]
      );
      console.log(`AUDIT RETENTION: Purged ${result.affectedRows} rows older than ${days} days.`);
    } catch (e) {
      console.error("AUDIT RETENTION ERROR:", e?.message || e);
    }
  }

  purge(); // run once on boot
  const timer = setInterval(purge, 24 * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
}

function startAlertCooldownCleanupJob() {
  const purgeDays = Number(process.env.ALERT_COOLDOWN_PURGE_DAYS || 30);

  if (!purgeDays || purgeDays < 1) {
    console.log("Alert cooldown cleanup disabled (ALERT_COOLDOWN_PURGE_DAYS not set or invalid).");
    return;
  }

  async function purge() {
    try {
      const [result] = await db.query(
        `DELETE FROM alert_cooldowns WHERE sent_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [purgeDays]
      );
      console.log(
        `ALERT COOLDOWN CLEANUP: Purged ${result.affectedRows} rows older than ${purgeDays} days.`
      );
    } catch (e) {
      console.error("ALERT COOLDOWN CLEANUP ERROR:", e?.message || e);
    }
  }

  purge(); // run once on boot
  const timer = setInterval(purge, 24 * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
}

startAuditRetentionJob();
startAlertCooldownCleanupJob();

/**
 * 404
 */
app.use((req, res) => {
  res.status(404).json({ message: "Not found" });
});

/**
 * ✅ Central error handler
 */
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err?.message || err);

  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked" });
  }

  res.status(500).json({ message: "Server error" });
});

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});


const PORT = Number(process.env.PORT || 5000);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
