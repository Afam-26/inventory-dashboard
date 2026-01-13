import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import productsRoutes from "./routes/products.js";
import categoriesRoutes from "./routes/categories.js";
import dashboardRoutes from "./routes/dashboard.js";
import stockRoutes from "./routes/stock.js";
import authRoutes from "./routes/auth.js";

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

const allowedOrigins = new Set([
  "https://inventory-dashboard-omega-five.vercel.app",
  "http://localhost:5173",
]);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    if (/^https:\/\/inventory-dashboard-.*\.vercel\.app$/.test(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Authorization"],
};

// ✅ This alone is enough for preflight
app.use(cors(corsOptions));

// ✅ Optional: short-circuit OPTIONS without wildcard routes (no path-to-regexp)
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => res.send("Inventory API running ✅"));
app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/stock", stockRoutes);

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
