class SchoolChatApp {
  constructor() {
    this.token = sessionStorage.getItem('token');
    this.username = sessionStorage.getItem('username');
    this.userId = sessionStorage.getItem('userId');
    this.role = sessionStorage.getItem('role');
    this.currentChannel = 'general';
    this.socket = null;
    this.messages = { general: [] };
    this.notifications = { general: 0 };
    this.activeUsers = [];
    this.typingUsers = {};
    this.typingTimeout = null;
    this.totalUnread = 0;
    this.windowFocused = !document.hidden;
    this.idleTimeout = null;
    this.IDLE_LIMIT = 30 * 60 * 1000; // 30 minutes
    this.slowmode = {};
    this.lastSentAt = {};
    this.slowCountdown = null;
    this.isMuted = false;
    this.muteExpiry = null;
    this.onlineUsers = {};

    if (this.token) {
      this.showChatApp();
    } else {
      this.showLoginPage();
    }
  }

  // ============ LOGIN PAGE ============
  showLoginPage() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="login-page">
        <div class="login-box">
          <h1>🎓 Classroom</h1>
          <div id="error" class="error"></div>
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" placeholder="Enter your username">
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" placeholder="Enter your password">
          </div>
          <button type="button" class="login-btn" onclick="chatApp.login()">Login</button>
        </div>
      </div>
    `;
    window.chatApp = this;
  }

  async login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('error');
    const btn = document.querySelector('.login-btn');

    if (!username || !password) {
      errorDiv.textContent = 'Please enter username and password';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Logging in…';
    errorDiv.textContent = '';

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        errorDiv.textContent = err.error || 'Invalid credentials';
        btn.disabled = false;
        btn.textContent = 'Login';
        return;
      }

      const data = await response.json();
      this.preAuthToken = data.preAuthToken;
      this.showPinScreen();
    } catch (error) {
      errorDiv.textContent = 'Login failed: ' + error.message;
      btn.disabled = false;
      btn.textContent = 'Login';
    }
  }

  showPinScreen() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="login-page">
        <div class="login-box">
          <h1>🔒 Enter PIN</h1>
          <p style="text-align:center;color:#7b7fa8;margin-bottom:24px;font-size:13px;">Enter your 4-digit security code</p>
          <div id="pin-error" class="error"></div>
          <div class="pin-inputs">
            <input type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="one-time-code" class="pin-digit" id="pin-0" onkeyup="chatApp.pinInput(event,0)" onkeydown="chatApp.pinKeydown(event,0)">
            <input type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="one-time-code" class="pin-digit" id="pin-1" onkeyup="chatApp.pinInput(event,1)" onkeydown="chatApp.pinKeydown(event,1)">
            <input type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="one-time-code" class="pin-digit" id="pin-2" onkeyup="chatApp.pinInput(event,2)" onkeydown="chatApp.pinKeydown(event,2)">
            <input type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="one-time-code" class="pin-digit" id="pin-3" onkeyup="chatApp.pinInput(event,3)" onkeydown="chatApp.pinKeydown(event,3)">
          </div>
          <button type="button" class="login-btn" onclick="chatApp.verifyPin()" style="margin-top:24px;">Verify PIN</button>
          <button type="button" onclick="chatApp.showLoginPage()" style="width:100%;margin-top:10px;background:none;border:none;color:#7b7fa8;cursor:pointer;font-size:13px;font-family:Poppins,sans-serif;">← Back to login</button>
        </div>
      </div>
    `;
    window.chatApp = this;
    document.getElementById('pin-0').focus();
  }

  pinInput(event, index) {
    const input = document.getElementById(`pin-${index}`);
    // Only keep digits
    input.value = input.value.replace(/[^0-9]/g, '').slice(0, 1);
    // Advance focus on digit entry (not on backspace/delete)
    if (input.value && index < 3 && event.key !== 'Backspace' && event.key !== 'Delete') {
      document.getElementById(`pin-${index + 1}`).focus();
    }
  }

  pinKeydown(event, index) {
    if (event.key === 'Backspace') {
      const input = document.getElementById(`pin-${index}`);
      if (!input.value && index > 0) {
        document.getElementById(`pin-${index - 1}`).focus();
      }
      return;
    }
    if (event.key === 'Enter') {
      this.verifyPin();
    }
  }

  async verifyPin() {
    const pin = [0,1,2,3].map(i => document.getElementById(`pin-${i}`)?.value || '').join('');
    const errorDiv = document.getElementById('pin-error');

    if (pin.length !== 4) {
      errorDiv.textContent = 'Please enter all 4 digits';
      return;
    }

    try {
      const response = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preAuthToken: this.preAuthToken, pin })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        errorDiv.textContent = err.error || 'Incorrect PIN';
        [0,1,2,3].forEach(i => { const el = document.getElementById(`pin-${i}`); if(el) el.value = ''; });
        document.getElementById('pin-0')?.focus();
        return;
      }

      const data = await response.json();
      sessionStorage.setItem('token', data.token);
      sessionStorage.setItem('username', data.username);
      sessionStorage.setItem('userId', data.userId);
      sessionStorage.setItem('role', data.role);

      this.token = data.token;
      this.username = data.username;
      this.userId = data.userId;
      this.role = data.role;

      this.showChatApp();
    } catch (error) {
      document.getElementById('pin-error').textContent = 'Verification failed: ' + error.message;
    }
  }

  // ============ CHAT APP ============
  showChatApp() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="chat-app">
        <div class="sidebar">
          <div class="sidebar-header">
            <h2>💬 Chat</h2>
            <div class="user-info">Logged as: ${this.username}</div>
          </div>
          <div class="sidebar-channels">
            <div class="channel-item active" onclick="chatApp.switchChannel('general')">
              <span># general</span>
              <span class="notification-badge" id="general-badge" style="display: none;">0</span>
            </div>
          </div>
          <div class="sidebar-footer">
            ${this.role === 'owner' ? '<button class="btn btn-primary" onclick="chatApp.openAdminPanel()">👤 Admin</button>' : ''}
            <button class="btn btn-danger" onclick="chatApp.logout()">Logout</button>
          </div>
        </div>

        <div class="main-content">
          <div class="chat-header">
            <h1># ${this.currentChannel}</h1>
            <div class="active-users" id="active-users"><span class="online-indicator"></span> Users online</div>
          </div>
          <div class="messages-container" id="messages"></div>
          <div class="typing-indicator" id="typing-indicator"></div>
          <div class="slowmode-bar" id="slowmode-bar" style="display:none"></div>
          <div class="mute-bar" id="mute-bar" style="display:none"></div>
          <div class="input-area">
            <input type="text" id="message-input" placeholder="Type a message..." onkeypress="if(event.key==='Enter') chatApp.sendMessage()" oninput="chatApp.handleTyping()">
            <button class="send-btn" id="send-btn" onclick="chatApp.sendMessage()">Send</button>
          </div>
        </div>
      </div>

      <div class="admin-panel" id="admin-panel">
        <div class="admin-header">
          <h2>⚙️ Admin Dashboard</h2>
          <button class="close-btn" onclick="chatApp.closeAdminPanel()">&times;</button>
        </div>
        <div class="admin-content">
          <div class="admin-tab-panel active" id="tab-users">
            <div class="admin-section">
              <h3>🐢 Slowmode (All Channels)</h3>
              <div class="slowmode-control">
                <select id="slowmode-seconds">
                  <option value="0">Off</option>
                  <option value="5">5 seconds</option>
                  <option value="10">10 seconds</option>
                  <option value="15">15 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="60">1 minute</option>
                  <option value="300">5 minutes</option>
                </select>
                <button type="button" class="btn btn-primary" onclick="chatApp.applySlowmode()">Apply to All</button>
              </div>
              <div id="slowmode-status" class="slowmode-status"></div>
            </div>
            <div class="admin-section">
              <h3>Create New User</h3>
              <div class="form-group-inline">
                <input type="text" id="new-username" placeholder="Username">
              </div>
              <div class="form-group-inline">
                <input type="password" id="new-password" placeholder="Password">
              </div>
              <div class="form-group-inline">
                <input type="text" inputmode="numeric" id="new-pin" placeholder="4-digit PIN" maxlength="4">
              </div>
              <button class="btn btn-primary" onclick="chatApp.createUser()" style="width: 100%;">Create User</button>
            </div>
            <div class="admin-section">
              <h3>Manage Users</h3>
              <div id="user-list"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    window.chatApp = this;
    this.connectSocket();
    this.loadMessages();
    if (this.role === 'owner') this.loadUsers();
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    window.addEventListener('focus', () => {
      this.windowFocused = true;
      this.totalUnread = 0;
      this.updateTabBadge();
    });
    window.addEventListener('blur', () => {
      this.windowFocused = false;
    });

    this.startIdleTimer();
  }

  startIdleTimer() {
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    const reset = () => {
      if (this.idleTimeout) clearTimeout(this.idleTimeout);
      this.idleTimeout = setTimeout(() => {
        alert('🔒 Logged out due to inactivity.');
        this.logout();
      }, this.IDLE_LIMIT);
    };
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(e => {
      document.addEventListener(e, reset, { passive: true });
    });
    reset();
  }

  // ============ SOCKET.IO CONNECTION ============
  connectSocket() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.socket = io({
      forceNew: true,
      auth: {
        token: this.token
      }
    });

    this.socket.on('connect', () => {
      console.log('✅ Connected to server');
      this.socket.emit('join_channel', this.currentChannel);
    });

    this.socket.on('receive_message', (message) => {
      if (!this.messages[message.channel]) {
        this.messages[message.channel] = [];
      }
      this.messages[message.channel].push(message);
      if (message.channel === this.currentChannel) {
        this.displayMessage(message);
        if (!this.windowFocused) {
          this.totalUnread++;
          this.updateTabBadge();
        }
      } else {
        this.addNotification(message.channel);
      }
    });

    this.socket.on('user_joined', (data) => {
      const messagesDiv = document.getElementById('messages');
      if (messagesDiv) {
        messagesDiv.innerHTML += `<div class="system-message">${data.message}</div>`;
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
    });

    this.socket.on('active_users_list', (users) => {
      this.onlineUsers = {};
      users.forEach(u => { this.onlineUsers[u.userId] = u.username; });
      this.renderActiveUsers();
    });

    this.socket.on('user_online', (data) => {
      this.onlineUsers[data.userId] = data.username;
      this.renderActiveUsers();
    });

    this.socket.on('user_offline', (data) => {
      delete this.onlineUsers[data.userId];
      this.renderActiveUsers();
    });

    this.socket.on('user_typing', (data) => {
      this.showTypingIndicator(data.username);
    });

    this.socket.on('user_stopped_typing', (data) => {
      this.removeTypingIndicator(data.username);
    });

    this.socket.on('notification', (data) => {
      if (data.channel !== this.currentChannel) {
        this.addNotification(data.channel);
        if (Notification.permission === 'granted') {
          new Notification(`New message in #${data.channel}`, {
            body: data.message,
            icon: '💬'
          });
        }
      }
    });

    this.socket.on('slowmode_init', (state) => {
      this.slowmode = state || {};
      this.updateSlowmodeBar();
    });

    this.socket.on('slowmode_update', (data) => {
      this.slowmode[data.channel] = data.seconds;
      this.updateSlowmodeBar();
    });

    this.socket.on('slowmode_blocked', (data) => {
      this.startSlowCountdown(data.wait);
    });

    this.socket.on('kicked', (data) => {
      alert('🚫 ' + (data.message || 'You have been kicked.'));
      this.logout();
    });

    this.socket.on('banned', (data) => {
      alert('⛔ ' + (data.message || 'You have been banned.'));
      this.logout();
    });

    this.socket.on('mute_status', (data) => {
      this.isMuted = data.muted;
      this.muteExpiry = data.expiresAt;
      this.updateMuteBar(data.message);
    });

    this.socket.on('unmuted', (data) => {
      this.isMuted = false;
      this.muteExpiry = null;
      this.updateMuteBar(null);
    });

    this.socket.on('muted_blocked', (data) => {
      this.updateMuteBar(data.message || '🔇 You are muted.');
    });
  }

  switchChannel(channel) {
    this.currentChannel = channel;
    this.notifications[channel] = 0;
    this.totalUnread = Object.values(this.notifications).reduce((a, b) => a + b, 0);
    this.updateTabBadge();
    this.refreshUI();
    this.socket.emit('join_channel', channel);
    this.loadMessages();
  }

  async loadMessages() {
    try {
      const response = await fetch(`/api/messages/${this.currentChannel}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const messages = await response.json();
      this.messages[this.currentChannel] = messages || [];
      this.displayMessages();
    } catch (error) {
      console.error('Failed to load messages', error);
    }
  }

  displayMessages() {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    messagesDiv.innerHTML = '';
    this.messages[this.currentChannel].forEach(msg => this.displayMessage(msg));
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  displayMessage(message) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv || message.channel !== this.currentChannel) return;

    const time = new Date(message.timestamp || message.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const html = `
      <div class="message">
        <div class="message-avatar">${message.username.charAt(0).toUpperCase()}</div>
        <div class="message-content">
          <div class="message-header">
            <span class="message-username">${message.username}</span>
            <span class="message-time">${time}</span>
          </div>
          <div class="message-text">${this.escapeHtml(message.text)}</div>
        </div>
      </div>
    `;
    messagesDiv.innerHTML += html;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  handleTyping() {
    if (!this.socket) return;
    this.socket.emit('typing_start', this.currentChannel);
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.socket.emit('typing_stop', this.currentChannel);
    }, 2000);
  }

  showTypingIndicator(username) {
    this.typingUsers[username] = true;
    this.renderTypingIndicator();
  }

  removeTypingIndicator(username) {
    delete this.typingUsers[username];
    this.renderTypingIndicator();
  }

  renderTypingIndicator() {
    const el = document.getElementById('typing-indicator');
    if (!el) return;
    const names = Object.keys(this.typingUsers);
    if (names.length === 0) {
      el.innerHTML = '';
    } else if (names.length === 1) {
      el.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> <em>${names[0]} is typing...</em>`;
    } else if (names.length === 2) {
      el.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> <em>${names[0]} and ${names[1]} are typing...</em>`;
    } else {
      el.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> <em>Several people are typing...</em>`;
    }
  }

  sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;

    // Client-side mute check
    if (this.isMuted && this.role !== 'owner') {
      const msg = this.muteExpiry ? `🔇 You are muted until ${new Date(this.muteExpiry).toLocaleTimeString()}.` : '🔇 You are muted and cannot send messages.';
      this.updateMuteBar(msg);
      return;
    }

    // Client-side slowmode check
    const slowSecs = this.slowmode[this.currentChannel] || 0;
    if (slowSecs > 0 && this.role !== 'owner') {
      const key = `${this.currentChannel}`;
      const last = this.lastSentAt[key] || 0;
      const elapsed = (Date.now() - last) / 1000;
      if (elapsed < slowSecs) {
        this.startSlowCountdown(Math.ceil(slowSecs - elapsed));
        return;
      }
      this.lastSentAt[key] = Date.now();
    }

    clearTimeout(this.typingTimeout);
    this.socket.emit('typing_stop', this.currentChannel);
    this.socket.emit('send_message', { channel: this.currentChannel, text });
    input.value = '';
  }

  updateMuteBar(message) {
    const bar = document.getElementById('mute-bar');
    if (!bar) return;
    if (message) {
      bar.style.display = 'block';
      bar.textContent = message;
    } else {
      bar.style.display = 'none';
    }
  }

  renderActiveUsers() {
    const el = document.getElementById('active-users');
    if (!el) return;
    const users = Object.entries(this.onlineUsers);
    const count = users.length;
    if (this.role === 'owner' && count > 0) {
      // Show clickable pills for OTHER users only (not self)
      const others = users.filter(([uid]) => parseInt(uid) !== parseInt(this.userId));
      let html = `<span class="online-indicator"></span> <strong>${count}</strong> online`;
      if (others.length > 0) {
        const pills = others.map(([uid, name]) =>
          `<span class="user-pill" onclick="chatApp.showUserContextMenu(${uid},'${name}',this)">${name}</span>`
        ).join('');
        html += `: ${pills}`;
      }
      el.innerHTML = html;
    } else {
      const label = count === 1 ? 'member online' : 'members online';
      el.innerHTML = `<span class="online-indicator"></span> <strong>${count}</strong> ${label}`;
    }
  }

  showUserContextMenu(userId, username, el) {
    this.closeUserContextMenu();
    const menu = document.createElement('div');
    menu.id = 'user-ctx-menu';
    menu.className = 'user-ctx-menu';
    menu.innerHTML = `
      <div class="ctx-header"><strong>${username}</strong> <button type="button" class="ctx-close" onclick="chatApp.closeUserContextMenu()">✕</button></div>
      <button type="button" class="ctx-btn ctx-kick" onclick="chatApp.kickUser(${userId},'${username}');chatApp.closeUserContextMenu()">🥾 Kick</button>
      <button type="button" class="ctx-btn ctx-ban"  onclick="chatApp.banUser(${userId},'${username}');chatApp.closeUserContextMenu()">⛔ Ban</button>
      <div class="ctx-mute-row">
        <select id="ctx-mute-dur">
          <option value="0">Permanent</option>
          <option value="60">1 min</option>
          <option value="300">5 min</option>
          <option value="600">10 min</option>
          <option value="1800">30 min</option>
          <option value="3600">1 hour</option>
        </select>
        <button type="button" class="ctx-btn ctx-mute" onclick="chatApp.adminMuteUser(${userId},'${username}',document.getElementById('ctx-mute-dur').value);chatApp.closeUserContextMenu()">🔇 Mute</button>
      </div>
      <button type="button" class="ctx-btn ctx-unmute" onclick="chatApp.adminUnmuteUser(${userId},'${username}');chatApp.closeUserContextMenu()">🔊 Unmute</button>
    `;
    // Append first so we can measure size
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);
    const rect = el.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let top = rect.bottom + 4;
    let left = rect.left;
    // Clamp so it doesn't clip off right or bottom edge
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (left < 8) left = 8;
    if (top + mh > window.innerHeight - 8) top = rect.top - mh - 4;
    if (top < 8) top = 8;
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    menu.style.visibility = 'visible';
    setTimeout(() => document.addEventListener('click', this._ctxOutside = (e) => {
      if (!menu.contains(e.target) && e.target !== el) this.closeUserContextMenu();
    }), 0);
  }

  closeUserContextMenu() {
    const m = document.getElementById('user-ctx-menu');
    if (m) m.remove();
    if (this._ctxOutside) { document.removeEventListener('click', this._ctxOutside); this._ctxOutside = null; }
  }

  async adminMuteUser(userId, username, duration) {
    try {
      const r = await fetch(`/api/admin/users/${userId}/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
        body: JSON.stringify({ duration: parseInt(duration) })
      });
      const d = await r.json();
      alert(r.ok ? `✅ ${d.message}` : `❌ ${d.error}`);
      if (r.ok) this.loadUsers();
    } catch (e) { alert('Failed to mute user'); }
  }

  async adminUnmuteUser(userId, username) {
    try {
      const r = await fetch(`/api/admin/users/${userId}/unmute`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const d = await r.json();
      alert(r.ok ? `✅ ${d.message}` : `❌ ${d.error}`);
      if (r.ok) this.loadUsers();
    } catch (e) { alert('Failed to unmute user'); }
  }

  updateSlowmodeBar() {
    const bar = document.getElementById('slowmode-bar');
    if (!bar) return;
    const secs = this.slowmode[this.currentChannel] || 0;
    if (secs > 0) {
      const label = secs >= 60 ? `${secs / 60} min` : `${secs}s`;
      bar.style.display = 'block';
      bar.textContent = `🐢 Slowmode: ${label} cooldown between messages`;
    } else {
      bar.style.display = 'none';
    }
  }

  startSlowCountdown(seconds) {
    if (this.slowCountdown) clearInterval(this.slowCountdown);
    const btn = document.getElementById('send-btn');
    const input = document.getElementById('message-input');
    if (btn) btn.disabled = true;
    if (input) input.disabled = true;
    let left = seconds;
    const update = () => {
      if (btn) btn.textContent = `Wait ${left}s`;
    };
    update();
    this.slowCountdown = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(this.slowCountdown);
        this.slowCountdown = null;
        if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
        if (input) input.disabled = false;
        this.lastSentAt[this.currentChannel] = Date.now() - (this.slowmode[this.currentChannel] || 0) * 1000;
      } else {
        update();
      }
    }, 1000);
  }

  addNotification(channel) {
    this.notifications[channel]++;
    this.totalUnread++;
    this.updateTabBadge();
    const badge = document.getElementById(`${channel}-badge`);
    if (badge) {
      badge.textContent = this.notifications[channel];
      badge.style.display = 'flex';
    }
  }

  updateTabBadge() {
    const count = this.totalUnread;
    document.title = count > 0 ? `(${count}) Classroom` : '🎓 Classroom';

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#5865f2';
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏫', 16, 17);

    if (count > 0) {
      ctx.fillStyle = '#f04747';
      ctx.beginPath();
      ctx.arc(25, 7, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'white';
      ctx.font = 'bold 9px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(count > 9 ? '9+' : String(count), 25, 7);
    }

    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = canvas.toDataURL('image/png');
  }

  updateActiveUsers(count) {
    this.renderActiveUsers();
  }

  // ============ ADMIN PANEL ============
  openAdminPanel() {
    document.getElementById('admin-panel').classList.add('open');
    this.loadUsers();
  }

  closeAdminPanel() {
    document.getElementById('admin-panel').classList.remove('open');
  }

  async loadUsers() {
    try {
      const response = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const users = await response.json();
      this.displayUsers(users);
    } catch (error) {
      console.error('Failed to load users', error);
    }
  }

  displayUsers(users) {
    const userList = document.getElementById('user-list');
    if (!userList) return;

    userList.innerHTML = users.map(user => `
      <div class="user-list-item">
        <div class="user-list-item-info">
          <div class="user-list-item-name">
            ${user.username}
            ${user.banned ? '<span class="banned-tag">BANNED</span>' : ''}
            ${user.muted ? '<span class="muted-tag">MUTED</span>' : ''}
          </div>
          <div class="user-list-item-status">
            ${user.role === 'owner' ? '👑 Owner' : '👤 Student'} &nbsp;·&nbsp; PIN: ${user.pin_code ? '••••' : '⚠️ not set'}
          </div>
        </div>
        ${user.role !== 'owner' ? `
          <div class="user-action-btns">
            <button class="action-btn kick-btn" onclick="chatApp.kickUser(${user.id}, '${user.username}')">Kick</button>
            ${user.banned
              ? `<button class="action-btn unban-btn" onclick="chatApp.unbanUser(${user.id}, '${user.username}')">Unban</button>`
              : `<button class="action-btn ban-btn" onclick="chatApp.banUser(${user.id}, '${user.username}')">Ban</button>`}
            ${user.muted
              ? `<button class="action-btn unmute-btn" onclick="chatApp.adminUnmuteUser(${user.id}, '${user.username}')">Unmute</button>`
              : `<select class="mute-dur-select" id="mute-dur-${user.id}">
                  <option value="0">Permanent</option>
                  <option value="60">1 min</option>
                  <option value="300">5 min</option>
                  <option value="600">10 min</option>
                  <option value="1800">30 min</option>
                  <option value="3600">1 hr</option>
                </select>
                <button class="action-btn mute-btn" onclick="chatApp.adminMuteUser(${user.id},'${user.username}',document.getElementById('mute-dur-${user.id}').value)">Mute</button>`}
            <button class="action-btn delete-user-btn" onclick="chatApp.deleteUser(${user.id})">Delete</button>
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  async kickUser(userId, username) {
    if (!confirm(`Kick ${username}? They will be disconnected but can log back in.`)) return;
    try {
      const r = await fetch(`/api/admin/users/${userId}/kick`, { method: 'POST', headers: { 'Authorization': `Bearer ${this.token}` } });
      const d = await r.json();
      alert(r.ok ? `✅ ${d.message}` : `❌ ${d.error}`);
    } catch (e) { alert('Failed to kick user'); }
  }

  async banUser(userId, username) {
    if (!confirm(`Ban ${username}? They will be disconnected and cannot log back in until unbanned.`)) return;
    try {
      const r = await fetch(`/api/admin/users/${userId}/ban`, { method: 'POST', headers: { 'Authorization': `Bearer ${this.token}` } });
      const d = await r.json();
      alert(r.ok ? `✅ ${d.message}` : `❌ ${d.error}`);
      if (r.ok) this.loadUsers();
    } catch (e) { alert('Failed to ban user'); }
  }

  async unbanUser(userId, username) {
    if (!confirm(`Unban ${username}?`)) return;
    try {
      const r = await fetch(`/api/admin/users/${userId}/unban`, { method: 'POST', headers: { 'Authorization': `Bearer ${this.token}` } });
      const d = await r.json();
      alert(r.ok ? `✅ ${d.message}` : `❌ ${d.error}`);
      if (r.ok) this.loadUsers();
    } catch (e) { alert('Failed to unban user'); }
  }

  async applySlowmode() {
    const seconds = parseInt(document.getElementById('slowmode-seconds').value);
    const statusEl = document.getElementById('slowmode-status');
    if (statusEl) statusEl.textContent = 'Applying…';
    try {
      const r = await fetch('/api/admin/slowmode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
        body: JSON.stringify({ channel: 'general', seconds })
      });
      if (r.ok) {
        this.slowmode['general'] = seconds;
        this.updateSlowmodeBar();
        const label = seconds === 0 ? 'Off' : seconds >= 60 ? `${seconds / 60} min` : `${seconds}s`;
        if (statusEl) statusEl.textContent = `✅ Slowmode ${seconds === 0 ? 'disabled' : `set to ${label}`}`;
      } else {
        if (statusEl) statusEl.textContent = '❌ Failed to apply slowmode';
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = '❌ Network error';
    }
  }

  async createUser() {
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    const pinCode = document.getElementById('new-pin').value;

    if (!username || !password || !pinCode) {
      alert('Please fill in all fields including the PIN');
      return;
    }

    if (!/^\d{4}$/.test(pinCode)) {
      alert('PIN must be exactly 4 digits');
      return;
    }

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ username, password, pinCode })
      });

      if (!response.ok) {
        const error = await response.json();
        alert('Error: ' + error.error);
        return;
      }

      document.getElementById('new-username').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('new-pin').value = '';
      alert(`✅ User "${username}" created successfully!`);
      this.loadUsers();
    } catch (error) {
      alert('❌ Error creating user: ' + error.message);
    }
  }

  async deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        alert('Failed to delete user');
        return;
      }

      alert('✅ User deleted successfully');
      this.loadUsers();
    } catch (error) {
      alert('❌ Error deleting user');
    }
  }

  // ============ UTILITIES ============
  refreshUI() {
    document.querySelectorAll('.channel-item').forEach(item => {
      item.classList.remove('active');
      if (item.textContent.includes(this.currentChannel)) {
        item.classList.add('active');
      }
    });

    document.querySelectorAll('.notification-badge').forEach(badge => {
      const channel = badge.id.split('-')[0];
      if (this.notifications[channel] > 0) {
        badge.textContent = this.notifications[channel];
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  logout() {
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    sessionStorage.clear();
    this.socket?.disconnect();
    this.showLoginPage();
  }
}

window.chatApp = new SchoolChatApp();
