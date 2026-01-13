import "dotenv/config";
import express from "express";
import cors from "cors";

// Routes
import authRoutes from "./routes/auth.js";
import productsRoutes from "./routes/products.js";
import categoriesRoutes from "./routes/categories.js";
import stockRoutes from "./routes/stock.js";
import dashboardRoutes from "./routes/dashboard.js";

const app = express();

/* ======================================================
   🔐 CORS LOCKDOWN (Vercel + Localhost ONLY)
====================================================== */

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "https://inventory-dashboard-omega-five.vercel.app",
]);

function isAllowedOrigin(origin) {
  if (!origin) return true; // allow curl, Postman, Railway health checks
  if (ALLOWED_ORIGINS.has(origin)) return true;

  // Allow Vercel preview deployments
  if (/^https:\/\/inventory-dashboard-.*\.vercel\.app$/.test(origin)) {
    return true;
  }

  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS_NOT_ALLOWED"));
    }
  },

  credentials: false, // JWT auth, NOT cookies
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Authorization"],
  maxAge: 86400, // cache preflight 24h
  optionsSuccessStatus: 204,
};

// Apply CORS globally
app.use(cors(corsOptions));

// IMPORTANT: Express 5 safe preflight handler
app.options(/.*/, cors(corsOptions));

/* ======================================================
   🧠 BODY PARSING
====================================================== */

app.use(express.json());

/* ======================================================
   🟢 HEALTH CHECK
====================================================== */

app.get("/", (req, res) => {
  res.send("Inventory API running ✅");
});

/* ======================================================
   🔐 API ROUTES
====================================================== */

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/dashboard", dashboardRoutes);

/* ======================================================
   🚫 CORS ERROR HANDLER
====================================================== */

app.use((err, req, res, next) => {
  if (err?.message === "CORS_NOT_ALLOWED") {
    return res.status(403).json({
      message: "CORS blocked: origin not allowed",
    });
  }
  next(err);
});

/* ======================================================
   ❌ FALLBACK ERROR HANDLER
====================================================== */

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ message: "Internal server error" });
});

/* ======================================================
   🚀 START SERVER
====================================================== */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
