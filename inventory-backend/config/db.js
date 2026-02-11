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

const host = process.env.DB_HOST || process.env.MYSQLHOST;
const port = Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306);
const user = process.env.DB_USER || process.env.MYSQLUSER;
const password = process.env.DB_PASSWORD || process.env.MYSQLPASSWORD;
const database = process.env.DB_NAME || process.env.MYSQLDATABASE;

// Optional: Railway sometimes exposes a full URL
const url = process.env.DATABASE_URL || process.env.MYSQL_URL;

export const db = url
  ? mysql.createPool(url)
  : mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 20000, // helps avoid instant fail on cold start
    });

