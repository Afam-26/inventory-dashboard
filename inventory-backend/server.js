import "dotenv/config";
import express from "express";
import cors from "cors";

import productsRoutes from "./routes/products.js";
import categoriesRoutes from "./routes/categories.js";
import dashboardRoutes from "./routes/dashboard.js";
import stockRoutes from "./routes/stock.js";

const app = express();
const allowedOrigins = new Set([
  "https://inventory-dashboard-omega-five.vercel.app",
  "http://localhost:5173",
]);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser tools (curl, Postman) where Origin is undefined
      if (!origin) return callback(null, true);

      // Allow exact match
      if (allowedOrigins.has(origin)) return callback(null, true);

      // Allow Vercel preview deployments (optional but recommended)
      // e.g. https://inventory-dashboard-xyz.vercel.app
      if (/^https:\/\/inventory-dashboard-.*\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }

      return callback(null, false); // <-- IMPORTANT: don't throw, just deny
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());


app.use(express.json());

app.get("/", (req, res) => res.send("Inventory API running ✅"));

app.use("/api/products", productsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/stock", stockRoutes);

app.listen(process.env.PORT || 5000, () => {
  console.log(`Backend running on http://localhost:${process.env.PORT || 5000}`);
});
