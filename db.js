const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'student',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        username VARCHAR(255) NOT NULL,
        channel VARCHAR(50) NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create index on channel for faster queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Get user by username
async function getUserByUsername(username) {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return result.rows[0];
}

// Get user by ID
async function getUserById(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

// Create new user
async function createUser(username, passwordHash) {
  const result = await pool.query(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING *',
    [username, passwordHash, 'student']
  );
  return result.rows[0];
}

// Get all users
async function getAllUsers() {
  const result = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
  return result.rows;
}

// Delete user
async function deleteUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

// Save message
async function saveMessage(userId, username, channel, text) {
  const result = await pool.query(
    'INSERT INTO messages (user_id, username, channel, text) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, username, channel, text]
  );
  return result.rows[0];
}

// Get messages by channel
async function getMessagesByChannel(channel, limit = 100) {
  const result = await pool.query(
    'SELECT id, username, channel, text, created_at FROM messages WHERE channel = $1 ORDER BY created_at DESC LIMIT $2',
    [channel, limit]
  );
  return result.rows.reverse(); // Reverse to get oldest first
}

module.exports = {
  pool,
  initializeDatabase,
  getUserByUsername,
  getUserById,
  createUser,
  getAllUsers,
  deleteUser,
  saveMessage,
  getMessagesByChannel
};
