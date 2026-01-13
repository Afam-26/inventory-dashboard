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

const app = express();

/**
 * Behind Railway/Proxies:
 * needed for correct IP + rate-limit behavior
 */
app.set("trust proxy", 1);

/**
 * ✅ Helmet (security headers)
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

/**
 * ✅ Body + cookies
 */
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

/**
 * ✅ Rate limit (global /api)
 */
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

/**
 * ✅ CORS (tight allowlist)
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
  exposedHeaders: ["Authorization"],
};

app.use(cors(corsOptions));

/**
 * ✅ Preflight (Express 5 safe)
 * NOTE: app.options("*") can crash in Express 5.
 * Using RegExp is safe.
 */
app.options(/.*/, cors(corsOptions));

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
