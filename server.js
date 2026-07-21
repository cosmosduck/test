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

// In-memory rate limiting
const loginAttempts = new Map();
const PIN_ATTEMPTS = 5;
const PASS_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// In-memory slowmode state (loaded from DB on startup)
const slowmode = {};         // { channel: seconds }
const lastMessageAt = {};    // { userId_channel: timestamp }

// In-memory mute state (loaded from DB on startup)
const mutedUsers = {};       // { userId: expiresAt_ms | Infinity }
const muteTimers = {};       // { userId: timeoutHandle }

function isUserMuted(userId) {
  const exp = mutedUsers[userId];
  if (exp === undefined) return false;
  if (exp === Infinity) return true;
  if (Date.now() < exp) return true;
  delete mutedUsers[userId];
  delete muteTimers[userId];
  db.unmuteUser(userId).catch(() => {});
  return false;
}

function applyMuteMemory(userId, durationMs) {
  if (muteTimers[userId]) clearTimeout(muteTimers[userId]);
  if (durationMs === 0) {
    mutedUsers[userId] = Infinity;
  } else {
    const expiresAt = Date.now() + durationMs;
    mutedUsers[userId] = expiresAt;
    muteTimers[userId] = setTimeout(() => {
      delete mutedUsers[userId];
      delete muteTimers[userId];
      db.unmuteUser(userId).catch(() => {});
      const active = activeUsers[userId];
      if (active) {
        const sock = io.sockets.sockets.get(active.socketId);
        if (sock) sock.emit('unmuted', { message: 'Your timeout has expired. You can chat again.' });
      }
    }, durationMs);
  }
}

function checkRateLimit(key, maxAttempts, res) {
  const now = Date.now();
  let record = loginAttempts.get(key);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + LOCKOUT_MINUTES * 60 * 1000 };
  }
  if (record.count >= maxAttempts) {
    const minutesLeft = Math.ceil((record.resetAt - now) / 60000);
    res.status(429).json({ error: `Too many attempts. Try again in ${minutesLeft} minutes.` });
    return false;
  }
  record.count++;
  loginAttempts.set(key, record);
  return true;
}

async function createOwnerAccount() {
  try {
    const ownerUsername = process.env.OWNER_USERNAME || 'admin';
    const ownerPassword = process.env.OWNER_PASSWORD || 'admin123';
    const pinCode = process.env.OWNER_PIN || '0000';
    const passwordHash = bcrypt.hashSync(ownerPassword, 10);

    // Find existing owner by role (not username — username may have changed)
    const existing = await db.pool.query("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
    if (existing.rows.length > 0) {
      // Update username, password, and pin to match env vars
      await db.pool.query(
        'UPDATE users SET username = $1, password_hash = $2, pin_code = $3 WHERE id = $4',
        [ownerUsername, passwordHash, pinCode, existing.rows[0].id]
      );
      console.log('✅ Owner credentials synced from env');
    } else {
      await db.pool.query(
        'INSERT INTO users (username, password_hash, role, pin_code) VALUES ($1, $2, $3, $4)',
        [ownerUsername, passwordHash, 'owner', pinCode]
      );
      console.log('✅ Owner account created');
    }
  } catch (error) {
    console.error('Error creating owner account:', error);
  }
}

// ONE-TIME OWNER RESET — remove after use
app.post('/api/reset-owner-x7k9', async (req, res) => {
  const { secret, username, password, pin } = req.body;
  if (secret !== 'reset-x7k9-2026') return res.status(403).json({ error: 'forbidden' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const existing = await db.pool.query("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
    if (existing.rows.length > 0) {
      await db.pool.query('UPDATE users SET username=$1, password_hash=$2, pin_code=$3 WHERE id=$4',
        [username, hash, pin, existing.rows[0].id]);
    } else {
      await db.pool.query('INSERT INTO users (username,password_hash,role,pin_code) VALUES ($1,$2,$3,$4)',
        [username, hash, 'owner', pin]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ AUTHENTICATION ROUTES ============

// Step 1: verify username + password, return pre-auth token
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

    const user = await db.getUserByUsername(username);
    if (!user) {
      const allowed = checkRateLimit(`pass:${ip}`, PASS_ATTEMPTS, res);
      await db.addSecurityLog('login_fail', username || '(unknown)', ip, 'User not found');
      if (!allowed) { await db.addSecurityLog('lockout', username || '(unknown)', ip, 'Too many failed attempts'); return; }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.banned) {
      await db.addSecurityLog('login_fail', username, ip, 'Banned account tried to log in');
      return res.status(403).json({ error: 'This account has been banned.' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      const allowed = checkRateLimit(`pass:${ip}:${username}`, PASS_ATTEMPTS, res);
      await db.addSecurityLog('login_fail', username, ip, 'Wrong password');
      if (!allowed) { await db.addSecurityLog('lockout', username, ip, 'Too many failed attempts'); return; }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await db.addSecurityLog('login_pass_ok', username, ip, 'Password accepted, awaiting PIN');

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

    const ip2 = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

    if (!user.pin_code || user.pin_code !== pin) {
      const allowed = checkRateLimit(`pin:${ip2}:${user.id}`, PIN_ATTEMPTS, res);
      await db.addSecurityLog('pin_fail', user.username, ip2, 'Wrong PIN entered');
      if (!allowed) { await db.addSecurityLog('lockout', user.username, ip2, 'Too many wrong PINs'); return; }
      return res.status(401).json({ error: 'Incorrect PIN' });
    }

    await db.addSecurityLog('login_success', user.username, ip2, 'Logged in successfully');

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '12h' }
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

// Get current slowmode settings
app.get('/api/slowmode', verifyToken, (req, res) => {
  res.json(slowmode);
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
    const result = users.map(u => ({
      ...u,
      muted: isUserMuted(u.id),
      muteExpiry: mutedUsers[u.id] === Infinity ? null : (mutedUsers[u.id] || null)
    }));
    res.json(result);
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

app.get('/api/admin/logs', verifyToken, isOwner, async (req, res) => {
  try {
    const logs = await db.getSecurityLogs(200);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

app.delete('/api/admin/logs', verifyToken, isOwner, async (req, res) => {
  try {
    await db.pool.query('DELETE FROM security_logs');
    res.json({ message: 'Logs cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear logs' });
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

// Kick a user (disconnect their socket)
app.post('/api/admin/users/:userId/kick', verifyToken, isOwner, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'owner') return res.status(400).json({ error: 'Cannot kick owner' });

    const active = activeUsers[userId];
    if (active) {
      const socket = io.sockets.sockets.get(active.socketId);
      if (socket) {
        socket.emit('kicked', { message: 'You have been kicked by the admin.' });
        socket.disconnect(true);
      }
    }
    await db.addSecurityLog('kick', user.username, null, `Kicked by owner`);
    res.json({ message: `${user.username} kicked` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to kick user' });
  }
});

// Ban a user (kick + mark banned in DB)
app.post('/api/admin/users/:userId/ban', verifyToken, isOwner, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'owner') return res.status(400).json({ error: 'Cannot ban owner' });

    await db.banUser(userId);

    const active = activeUsers[userId];
    if (active) {
      const socket = io.sockets.sockets.get(active.socketId);
      if (socket) {
        socket.emit('banned', { message: 'You have been banned.' });
        socket.disconnect(true);
      }
    }
    await db.addSecurityLog('ban', user.username, null, `Banned by owner`);
    res.json({ message: `${user.username} banned` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// Unban a user
app.post('/api/admin/users/:userId/unban', verifyToken, isOwner, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await db.unbanUser(userId);
    await db.addSecurityLog('unban', user.username, null, `Unbanned by owner`);
    res.json({ message: `${user.username} unbanned` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// Mute / timeout a user
app.post('/api/admin/users/:userId/mute', verifyToken, isOwner, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const duration = parseInt(req.body.duration) || 0; // seconds; 0 = permanent
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'owner') return res.status(400).json({ error: 'Cannot mute owner' });

    const durationMs = duration * 1000;
    applyMuteMemory(userId, durationMs);
    const expiresAt = durationMs ? new Date(Date.now() + durationMs) : null;
    await db.muteUser(userId, expiresAt);

    const active = activeUsers[userId];
    if (active) {
      const sock = io.sockets.sockets.get(active.socketId);
      if (sock) {
        const label = duration ? `for ${duration >= 3600 ? duration/3600 + 'h' : duration >= 60 ? duration/60 + ' min' : duration + 's'}` : 'permanently';
        sock.emit('mute_status', {
          muted: true,
          expiresAt: mutedUsers[userId] === Infinity ? null : mutedUsers[userId],
          message: `🔇 You have been muted ${label}.`
        });
      }
    }

    const label = duration ? `${duration}s timeout` : 'permanent mute';
    await db.addSecurityLog('mute', user.username, null, `${label} by owner`);
    res.json({ message: `${user.username} muted (${label})` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mute user' });
  }
});

// Unmute a user
app.post('/api/admin/users/:userId/unmute', verifyToken, isOwner, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (muteTimers[userId]) clearTimeout(muteTimers[userId]);
    delete mutedUsers[userId];
    delete muteTimers[userId];
    await db.unmuteUser(userId);

    const active = activeUsers[userId];
    if (active) {
      const sock = io.sockets.sockets.get(active.socketId);
      if (sock) sock.emit('unmuted', { message: '🔊 You have been unmuted.' });
    }

    await db.addSecurityLog('unmute', user.username, null, `Unmuted by owner`);
    res.json({ message: `${user.username} unmuted` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unmute user' });
  }
});

// Set slowmode for a channel
app.post('/api/admin/slowmode', verifyToken, isOwner, (req, res) => {
  const { channel, seconds } = req.body;
  const secs = parseInt(seconds) || 0;
  if (!channel) return res.status(400).json({ error: 'Channel required' });
  slowmode[channel] = secs;
  db.setSlowmode(channel, secs).catch(err => console.error('slowmode db:', err.message));
  io.emit('slowmode_update', { channel, seconds: secs });
  res.json({ message: `Slowmode set to ${secs}s for #${channel}` });
});

// ============ SOCKET.IO REAL-TIME CHAT ============

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.step === 'verify_pin') {
      return next(new Error('Authentication failed'));
    }
    // Check if user is banned
    const dbUser = await db.getUserById(user.userId);
    if (!dbUser || dbUser.banned) {
      return next(new Error('Account banned'));
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

  // Send current slowmode state to this client
  socket.emit('slowmode_init', slowmode);

  // Send full active users list to this new client
  socket.emit('active_users_list', Object.entries(activeUsers).map(([uid, data]) => ({
    userId: parseInt(uid), username: data.username
  })));

  // Send mute status if this user is muted
  if (isUserMuted(userId)) {
    const exp = mutedUsers[userId];
    socket.emit('mute_status', {
      muted: true,
      expiresAt: exp === Infinity ? null : exp,
      message: exp === Infinity ? '🔇 You are permanently muted.' : `🔇 You are muted until ${new Date(exp).toLocaleTimeString()}.`
    });
  }

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

      // Enforce mute server-side
      if (isUserMuted(userId) && role !== 'owner') {
        const exp = mutedUsers[userId];
        socket.emit('muted_blocked', {
          message: exp === Infinity ? '🔇 You are muted and cannot send messages.' : `🔇 You are muted until ${new Date(exp).toLocaleTimeString()}.`
        });
        return;
      }

      // Enforce slowmode server-side
      const slowSecs = slowmode[channel] || 0;
      if (slowSecs > 0 && role !== 'owner') {
        const key = `${userId}_${channel}`;
        const last = lastMessageAt[key] || 0;
        const elapsed = (Date.now() - last) / 1000;
        if (elapsed < slowSecs) {
          const wait = Math.ceil(slowSecs - elapsed);
          socket.emit('slowmode_blocked', { channel, wait });
          return;
        }
        lastMessageAt[key] = Date.now();
      }

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
    io.emit('user_offline', { userId, count: Object.keys(activeUsers).length });
    console.log(`❌ ${username} disconnected`);
  });
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  await db.initializeDatabase();
  await createOwnerAccount();
  // Load slowmode settings from DB
  try {
    const rows = await db.getSlowmodes();
    rows.forEach(r => { slowmode[r.channel] = r.seconds; });
    console.log('✅ Slowmode settings loaded');
  } catch (e) {
    console.log('⚠️ Could not load slowmode settings');
  }
  // Load muted users from DB
  try {
    const mutes = await db.getMutedUsers();
    const now = Date.now();
    mutes.forEach(m => {
      const exp = m.expires_at ? new Date(m.expires_at).getTime() : Infinity;
      if (exp === Infinity || exp > now) {
        mutedUsers[m.user_id] = exp;
        if (exp !== Infinity) {
          const remaining = exp - now;
          muteTimers[m.user_id] = setTimeout(() => {
            delete mutedUsers[m.user_id];
            delete muteTimers[m.user_id];
            db.unmuteUser(m.user_id).catch(() => {});
          }, remaining);
        }
      } else {
        db.unmuteUser(m.user_id).catch(() => {});
      }
    });
    console.log('✅ Mute state loaded');
  } catch (e) {
    console.log('⚠️ Could not load mute state');
  }
});

module.exports = app;
