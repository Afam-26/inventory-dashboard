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

// Railway provides MYSQL_URL (private/internal)
const railwayUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;

const host = process.env.DB_HOST || process.env.MYSQLHOST;
const port = Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306);
const user = process.env.DB_USER || process.env.MYSQLUSER;
const password = process.env.DB_PASSWORD || process.env.MYSQLPASSWORD;
const database = process.env.DB_NAME || process.env.MYSQLDATABASE;

// Create pool using URL if present (recommended on Railway)
export const db = railwayUrl
  ? mysql.createPool(railwayUrl)
  : mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 20000,
    });


console.log("DB using URL:", Boolean(railwayUrl));
console.log("DB host:", host, "port:", port, "db:", database);
