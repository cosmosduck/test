const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';

// Create owner account if it doesn't exist
async function createOwnerAccount() {
  try {
    const owner = await db.getUserByUsername(process.env.OWNER_USERNAME || 'admin');
    if (!owner) {
      const passwordHash = bcrypt.hashSync(process.env.OWNER_PASSWORD || 'admin123', 10);
      const ownerUser = {
        username: process.env.OWNER_USERNAME || 'admin',
        password_hash: passwordHash,
        role: 'owner'
      };
      await db.pool.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        [ownerUser.username, ownerUser.password_hash, ownerUser.role]
      );
      console.log('✅ Owner account created');
    }
  } catch (error) {
    console.error('Error creating owner account:', error);
  }
}

// ============ AUTHENTICATION ROUTES ============

// Login route
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      username: user.username,
      role: user.role,
      userId: user.id
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify token middleware
function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Get chat history
app.get('/api/messages/:channel', verifyToken, async (req, res) => {
  try {
    const channel = req.params.channel;
    const messages = await db.getMessagesByChannel(channel, 100);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// ============ OWNER DASHBOARD ROUTES ============

// Check if user is owner
function isOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner only' });
  }
  next();
}

// Get all users (owner only)
app.get('/api/admin/users', verifyToken, isOwner, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Create new user credentials (owner only)
app.post('/api/admin/users', verifyToken, isOwner, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const existingUser = await db.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    await db.createUser(username, passwordHash);

    res.json({ message: 'User created successfully', username });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Delete user credentials (owner only)
app.delete('/api/admin/users/:userId', verifyToken, isOwner, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    const user = await db.getUserById(userId);
    if (user && user.role === 'owner') {
      return res.status(400).json({ error: 'Cannot delete owner account' });
    }

    await db.deleteUser(userId);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ============ SOCKET.IO REAL-TIME CHAT ============

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Authentication failed'));
  }
});

const activeUsers = {}; // Track online users

io.on('connection', (socket) => {
  const userId = socket.user.userId;
  const username = socket.user.username;
  const role = socket.user.role;

  // Track active users
  activeUsers[userId] = { username, socketId: socket.id, role };
  io.emit('user_online', { userId, username, count: Object.keys(activeUsers).length });

  console.log(`✅ ${username} connected`);

  // Join channel
  socket.on('join_channel', (channel) => {
    socket.join(channel);
    io.to(channel).emit('user_joined', {
      username,
      message: `✨ ${username} joined #${channel}`
    });
  });

  // Typing indicator
  socket.on('typing_start', (channel) => {
    socket.to(channel).emit('user_typing', { username });
  });

  socket.on('typing_stop', (channel) => {
    socket.to(channel).emit('user_stopped_typing', { username });
  });

  // Send message
  socket.on('send_message', async (data) => {
    try {
      const { channel, text } = data;

      // Save to database
      const savedMessage = await db.saveMessage(userId, username, channel, text);

      const message = {
        id: savedMessage.id,
        username,
        userId,
        text,
        timestamp: savedMessage.created_at,
        channel
      };

      // Broadcast to channel
      io.to(channel).emit('receive_message', message);

      // Notify users not in channel
      socket.broadcast.emit('notification', {
        username,
        channel,
        message: `${username}: ${text.substring(0, 30)}...`
      });
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  // User disconnect
  socket.on('disconnect', () => {
    delete activeUsers[userId];
    io.emit('user_offline', { userId, username, count: Object.keys(activeUsers).length });
    console.log(`❌ ${username} disconnected`);
  });
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Database: ${process.env.DATABASE_URL || 'Local PostgreSQL'}`);
  await db.initializeDatabase();
  await createOwnerAccount();
});

module.exports = app;
