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

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';

async function createOwnerAccount() {
  try {
    const owner = await db.getUserByUsername(process.env.OWNER_USERNAME || 'admin');
    if (!owner) {
      const passwordHash = bcrypt.hashSync(process.env.OWNER_PASSWORD || 'admin123', 10);
      const pinCode = process.env.OWNER_PIN || '0000';
      await db.pool.query(
        'INSERT INTO users (username, password_hash, role, pin_code) VALUES ($1, $2, $3, $4)',
        [process.env.OWNER_USERNAME || 'admin', passwordHash, 'owner', pinCode]
      );
      console.log('✅ Owner account created');
    } else if (!owner.pin_code) {
      const pinCode = process.env.OWNER_PIN || '0000';
      await db.pool.query('UPDATE users SET pin_code = $1 WHERE id = $2', [pinCode, owner.id]);
      console.log('✅ Owner PIN set');
    }
  } catch (error) {
    console.error('Error creating owner account:', error);
  }
}

// ============ AUTHENTICATION ROUTES ============

// Step 1: verify username + password, return pre-auth token
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

    const preAuthToken = jwt.sign(
      { userId: user.id, step: 'verify_pin' },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    res.json({ preAuthToken, requiresPin: true });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Step 2: verify PIN, return full token
app.post('/api/verify-pin', async (req, res) => {
  try {
    const { preAuthToken, pin } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(preAuthToken, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    if (decoded.step !== 'verify_pin') {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const user = await db.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!user.pin_code || user.pin_code !== pin) {
      return res.status(401).json({ error: 'Incorrect PIN' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, username: user.username, role: user.role, userId: user.id });
  } catch (error) {
    res.status(500).json({ error: 'PIN verification failed' });
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
    const messages = await db.getMessagesByChannel(req.params.channel, 100);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// ============ OWNER DASHBOARD ROUTES ============

function isOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner only' });
  }
  next();
}

app.get('/api/admin/users', verifyToken, isOwner, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

app.post('/api/admin/users', verifyToken, isOwner, async (req, res) => {
  try {
    const { username, password, pinCode } = req.body;

    if (!username || !password || !pinCode) {
      return res.status(400).json({ error: 'Username, password, and PIN required' });
    }

    if (!/^\d{4}$/.test(pinCode)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    const existingUser = await db.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    await db.createUser(username, passwordHash, pinCode);

    res.json({ message: 'User created successfully', username });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

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
    if (user.step === 'verify_pin') {
      return next(new Error('Authentication failed'));
    }
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Authentication failed'));
  }
});

const activeUsers = {};

io.on('connection', (socket) => {
  const userId = socket.user.userId;
  const username = socket.user.username;
  const role = socket.user.role;

  activeUsers[userId] = { username, socketId: socket.id, role };
  io.emit('user_online', { userId, username, count: Object.keys(activeUsers).length });

  console.log(`✅ ${username} connected`);

  socket.on('join_channel', (channel) => {
    socket.join(channel);
    io.to(channel).emit('user_joined', {
      username,
      message: `✨ ${username} joined #${channel}`
    });
  });

  socket.on('typing_start', (channel) => {
    socket.to(channel).emit('user_typing', { username: socket.user.username });
  });

  socket.on('typing_stop', (channel) => {
    socket.to(channel).emit('user_stopped_typing', { username: socket.user.username });
  });

  socket.on('send_message', async (data) => {
    try {
      const { channel, text } = data;
      const savedMessage = await db.saveMessage(userId, username, channel, text);
      const message = {
        id: savedMessage.id,
        username,
        userId,
        text,
        timestamp: savedMessage.created_at,
        channel
      };
      io.to(channel).emit('receive_message', message);
      socket.broadcast.emit('notification', {
        username,
        channel,
        message: `${username}: ${text.substring(0, 30)}...`
      });
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  socket.on('disconnect', () => {
    delete activeUsers[userId];
    io.emit('user_offline', { userId, username, count: Object.keys(activeUsers).length });
    console.log(`❌ ${username} disconnected`);
  });
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  await db.initializeDatabase();
  await createOwnerAccount();
});

module.exports = app;
