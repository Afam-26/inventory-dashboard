import mysql from "mysql2/promise";

export const db = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});


console.log("ENV AT DB INIT:", process.env.DB_USER, process.env.DB_NAME);
console.log("DB_PASSWORD length:", (process.env.DB_PASSWORD || "").length);
