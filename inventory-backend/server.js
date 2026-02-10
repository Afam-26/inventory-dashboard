// server.js
import dotenv from "dotenv";
dotenv.config();

import { fileURLToPath } from "url";
import path from "path";
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
import tenantsRouter from "./middleware/tenants.js";
import healthRoutes from "./routes/health.js";
import invitesRouter from "./routes/invites.js";
import billingRouter, { billingWebhookHandler } from "./routes/billing.js";
import publicRoutes from "./routes/public.js";
import settingsRoutes from "./routes/settings.js";

import { scheduleDailySnapshots } from "./utils/auditSnapshots.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

/* ======================================================
   CORE APP SETTINGS
====================================================== */
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.set("etag", false);

/* ======================================================
   CORS (MUST BE BEFORE ROUTES)
====================================================== */
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-tenant-id"],
    exposedHeaders: ["Authorization", "Set-Cookie"],
  })
);

// Preflight
app.options(/.*/, cors());

/* ======================================================
   SECURITY HEADERS
====================================================== */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

/* ======================================================
   STRIPE WEBHOOK (RAW BODY ONLY, ONCE)
====================================================== */
app.post(
  "/api/billing/stripe/webhook",
  express.raw({ type: "application/json" }),
  billingWebhookHandler
);

/* ======================================================
   BODY + COOKIES
====================================================== */
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

/* ======================================================
   API NO-CACHE
====================================================== */
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

/* ======================================================
   RATE LIMITING
====================================================== */
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
});
app.use("/api", apiLimiter);

/* ======================================================
   ROUTES
====================================================== */
app.get("/", (req, res) => res.send("Inventory API running ✅"));

app.use("/api/auth", authRoutes);
app.use("/api/billing", billingRouter);
app.use("/api/products", productsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/tenants", tenantsRouter);
app.use("/api/invites", invitesRouter);
app.use("/api/public", publicRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/health", healthRoutes);

// admin alias
app.use("/api/admin/audit", auditRoutes);

/* ======================================================
   JOBS
====================================================== */
scheduleDailySnapshots(db, { hourUtc: 0, minuteUtc: 5 });

/* ======================================================
   404 + ERROR HANDLER
====================================================== */
app.use((req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err?.message || err);
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked" });
  }
  res.status(500).json({ message: "Server error" });
});

/* ======================================================
   START
====================================================== */
app.listen(process.env.PORT || 5000, () => {
  console.log(`Backend running on http://localhost:${process.env.PORT || 5000}`);
});
