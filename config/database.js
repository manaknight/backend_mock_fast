const mysql = require('mysql2/promise');

let connection = null;

const connectDB = async () => {
  try {
    if (!connection) {
      connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'manda_club',
        port: process.env.DB_PORT || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        acquireTimeout: 60000,
        timeout: 60000,
      });

      console.log('✅ Database connected successfully');
    }
    return connection;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
};

const getConnection = () => {
  if (!connection) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return connection;
};

const closeConnection = async () => {
  if (connection) {
    await connection.end();
    connection = null;
    console.log('🔌 Database connection closed');
  }
};

module.exports = {
  connectDB,
  getConnection,
  closeConnection
};
