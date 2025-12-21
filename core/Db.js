// src/core/Db.js
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: true,
  } : false,
  waitForConnections: true,
  connectionLimit: 10, // Reduced for PlanetScale
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 30000, // 30 seconds
});

// Add error handling for the pool
pool.on("error", (err) => {
  console.error("Unexpected error on idle database connection:", err);
});

module.exports = pool;
