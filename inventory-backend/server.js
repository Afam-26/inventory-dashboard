import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";

import productsRoutes from "./routes/products.js";
import categoriesRoutes from "./routes/categories.js";
import dashboardRoutes from "./routes/dashboard.js";
import stockRoutes from "./routes/stock.js";
import authRoutes from "./routes/auth.js";
import auditRoutes from "./routes/audit.js";
import usersRoutes from "./routes/users.js";




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

/**
 * ✅ CORS (tight allowlist)
 * IMPORTANT: CORS must run BEFORE rate limit so OPTIONS/preflight isn't blocked.
 */
const allowedOrigins = new Set([
  "https://inventory-dashboard-omega-five.vercel.app",
  "http://localhost:5173",
]);

const corsOptions = {
  origin: (origin, cb) => {
    // allow curl/postman/no-origin
    if (!origin) return cb(null, true);

    if (allowedOrigins.has(origin)) return cb(null, true);

    // allow Vercel preview deploys
    if (/^https:\/\/inventory-dashboard-.*\.vercel\.app$/.test(origin)) return cb(null, true);

    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Authorization", "Set-Cookie"],
};

app.use(cors(corsOptions));

/**
 * ✅ Preflight (Express 5 safe)
 * app.options("*") / "/*" can crash in Express 5 due to path-to-regexp changes.
 * RegExp is safe.
 */
app.options(/.*/, cors(corsOptions));

/**
 * ✅ Body + cookies
 * cookieParser is required for refresh token cookie flows.
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

/**
 * 404
 */
app.use((req, res) => {
  res.status(404).json({ message: "Not found" });
});

/**
 * ✅ Central error handler (includes CORS rejection)
 */
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err?.message || err);

  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked" });
  }

  res.status(500).json({ message: "Server error" });
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`Backend running on http://localhost:${process.env.PORT || 5000}`);
});
