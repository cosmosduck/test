const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'student',
        pin_code VARCHAR(4),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_code VARCHAR(4);
    `);

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

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_logs (
        id SERIAL PRIMARY KEY,
        event VARCHAR(50) NOT NULL,
        username VARCHAR(255),
        ip VARCHAR(100),
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_security_logs_created ON security_logs(created_at DESC);
    `);

    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS slowmode (
        channel VARCHAR(50) PRIMARY KEY,
        seconds INTEGER NOT NULL DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS muted_users (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ
      );
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

async function getUserByUsername(username) {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return result.rows[0];
}

async function getUserById(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

async function createUser(username, passwordHash, pinCode) {
  const result = await pool.query(
    'INSERT INTO users (username, password_hash, role, pin_code) VALUES ($1, $2, $3, $4) RETURNING *',
    [username, passwordHash, 'student', pinCode]
  );
  return result.rows[0];
}

async function getAllUsers() {
  const result = await pool.query(
    'SELECT id, username, role, pin_code, banned, created_at FROM users ORDER BY created_at DESC'
  );
  return result.rows;
}

async function banUser(userId) {
  await pool.query('UPDATE users SET banned = TRUE WHERE id = $1', [userId]);
}

async function unbanUser(userId) {
  await pool.query('UPDATE users SET banned = FALSE WHERE id = $1', [userId]);
}

async function setSlowmode(channel, seconds) {
  await pool.query(
    'INSERT INTO slowmode (channel, seconds) VALUES ($1, $2) ON CONFLICT (channel) DO UPDATE SET seconds = $2',
    [channel, seconds]
  );
}

async function getSlowmodes() {
  const result = await pool.query('SELECT channel, seconds FROM slowmode');
  return result.rows;
}

async function muteUser(userId, expiresAt) {
  await pool.query(
    'INSERT INTO muted_users (user_id, expires_at) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET expires_at = $2',
    [userId, expiresAt || null]
  );
}

async function unmuteUser(userId) {
  await pool.query('DELETE FROM muted_users WHERE user_id = $1', [userId]);
}

async function getMutedUsers() {
  const result = await pool.query('SELECT user_id, expires_at FROM muted_users');
  return result.rows;
}

async function deleteUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

async function saveMessage(userId, username, channel, text) {
  const result = await pool.query(
    'INSERT INTO messages (user_id, username, channel, text) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, username, channel, text]
  );
  return result.rows[0];
}

async function getMessagesByChannel(channel, limit = 100) {
  const result = await pool.query(
    'SELECT id, username, channel, text, created_at FROM messages WHERE channel = $1 ORDER BY created_at DESC LIMIT $2',
    [channel, limit]
  );
  return result.rows.reverse();
}

async function addSecurityLog(event, username, ip, details) {
  try {
    await pool.query(
      'INSERT INTO security_logs (event, username, ip, details) VALUES ($1, $2, $3, $4)',
      [event, username || null, ip || null, details || null]
    );
  } catch (err) {
    console.error('Failed to write security log:', err.message);
  }
}

async function getSecurityLogs(limit = 200) {
  const result = await pool.query(
    'SELECT * FROM security_logs ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return result.rows;
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
  getMessagesByChannel,
  addSecurityLog,
  getSecurityLogs,
  banUser,
  unbanUser,
  setSlowmode,
  getSlowmodes,
  muteUser,
  unmuteUser,
  getMutedUsers
};
