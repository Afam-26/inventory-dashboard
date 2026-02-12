// import mysql from "mysql2/promise";
// import "dotenv/config";

// export const db = mysql.createPool({
//   host: process.env.DB_HOST,
//   port: Number(process.env.DB_PORT || 3306),
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
// });


// config/db.js
import mysql from "mysql2/promise";
import "dotenv/config";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 20000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

/**
 * Retry DB readiness on startup (handles Railway hiccups / DB restarts)
 */
export async function waitForDbReady({
  maxAttempts = 12,
  baseDelayMs = 800,
  maxDelayMs = 8000,
} = {}) {
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.query("SELECT 1");
      return { ok: true, attempts: attempt };
    } catch (e) {
      lastErr = e;
      const code = e?.code || "";
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(1.6, attempt - 1));

      console.error(
        `DB not ready (attempt ${attempt}/${maxAttempts}) code=${code} msg=${e?.message}`
      );

      await sleep(delay);
    }
  }

  return { ok: false, attempts: maxAttempts, error: lastErr };
}
