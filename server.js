const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

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

// In-memory storage (replace with database for production)
let users = [
  {
    id: 'owner',
    username: process.env.OWNER_USERNAME || 'admin',
    passwordHash: bcrypt.hashSync(process.env.OWNER_PASSWORD || 'admin123', 10),
    role: 'owner'
  }
];

let messages = {
  general: [],
  class: []
};

let activeUsers = {}; // Track online users

// ============ AUTHENTICATION ROUTES ============

// Login route
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username, role: user.role });
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
app.get('/api/messages/:channel', verifyToken, (req, res) => {
  const channel = req.params.channel;
  if (!messages[channel]) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  res.json(messages[channel]);
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
app.get('/api/admin/users', verifyToken, isOwner, (req, res) => {
  res.json(users.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    isOnline: activeUsers[u.id] ? true : false
  })));
});

// Create new user credentials (owner only)
app.post('/api/admin/users', verifyToken, isOwner, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const newUser = {
    id: Date.now().toString(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'student'
  };

  users.push(newUser);
  res.json({ message: 'User created', username });
});

// Delete user credentials (owner only)
app.delete('/api/admin/users/:userId', verifyToken, isOwner, (req, res) => {
  const userId = req.params.userId;

  if (userId === 'owner') {
    return res.status(400).json({ error: 'Cannot delete owner account' });
  }

  users = users.filter(u => u.id !== userId);
  res.json({ message: 'User deleted' });
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

io.on('connection', (socket) => {
  const userId = socket.user.userId;
  const username = socket.user.username;

  // Track active users
  activeUsers[userId] = { username, socketId: socket.id };
  io.emit('user_online', { userId, username });

  console.log(`${username} connected`);

  // Join channel
  socket.on('join_channel', (channel) => {
    socket.join(channel);
    io.to(channel).emit('user_joined', { username, message: `${username} joined ${channel}` });
  });

  // Send message
  socket.on('send_message', (data) => {
    const { channel, text } = data;
    const message = {
      id: Date.now(),
      username,
      userId,
      text,
      timestamp: new Date(),
      channel
    };

    // Store message
    if (!messages[channel]) messages[channel] = [];
    messages[channel].push(message);

    // Broadcast to channel
    io.to(channel).emit('receive_message', message);
    
    // Notify users not in channel
    socket.broadcast.emit('notification', {
      username,
      channel,
      message: `${username}: ${text.substring(0, 30)}...`
    });
  });

  // User disconnect
  socket.on('disconnect', () => {
    delete activeUsers[userId];
    io.emit('user_offline', { userId, username });
    console.log(`${username} disconnected`);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
