const BACKEND = 'https://test-kt8b.onrender.com';

class SchoolChatApp {
  constructor() {
    this.token = sessionStorage.getItem('token');
    this.username = sessionStorage.getItem('username');
    this.userId = sessionStorage.getItem('userId');
    this.role = sessionStorage.getItem('role');
    this.currentChannel = 'general';
    this.socket = null;
    this.messages = { general: [], class: [] };
    this.notifications = { general: 0, class: 0 };
    this.activeUsers = [];
    this.typingUsers = {};
    this.typingTimeout = null;
    this.totalUnread = 0;
    this.windowFocused = !document.hidden;

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
          <h1>🎓 School Chat</h1>
          <div id="error" class="error"></div>
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" placeholder="Enter your username">
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" placeholder="Enter your password">
          </div>
          <button class="login-btn" onclick="chatApp.login()">Login</button>
        </div>
      </div>
    `;
    window.chatApp = this;
  }

  async login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('error');

    if (!username || !password) {
      errorDiv.textContent = 'Please enter username and password';
      return;
    }

    try {
      const response = await fetch(`${BACKEND}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        errorDiv.textContent = err.error || `Server error (${response.status})`;
        return;
      }

      const data = await response.json();
      this.preAuthToken = data.preAuthToken;
      this.showPinScreen();
    } catch (error) {
      errorDiv.textContent = 'Login failed: ' + error.message;
    }
  }

  showPinScreen() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="login-page">
        <div class="login-box">
          <h1>🔒 Enter PIN</h1>
          <p style="text-align:center;color:#aaa;margin-bottom:24px;font-size:14px;">Enter your 4-digit security code</p>
          <div id="pin-error" class="error"></div>
          <div class="pin-inputs">
            <input type="password" inputmode="numeric" maxlength="1" class="pin-digit" id="pin-0" oninput="chatApp.pinInput(0)" onkeydown="chatApp.pinKeydown(event,0)">
            <input type="password" inputmode="numeric" maxlength="1" class="pin-digit" id="pin-1" oninput="chatApp.pinInput(1)" onkeydown="chatApp.pinKeydown(event,1)">
            <input type="password" inputmode="numeric" maxlength="1" class="pin-digit" id="pin-2" oninput="chatApp.pinInput(2)" onkeydown="chatApp.pinKeydown(event,2)">
            <input type="password" inputmode="numeric" maxlength="1" class="pin-digit" id="pin-3" oninput="chatApp.pinInput(3)" onkeydown="chatApp.pinKeydown(event,3)">
          </div>
          <button class="login-btn" onclick="chatApp.verifyPin()" style="margin-top:24px;">Verify</button>
          <button onclick="chatApp.showLoginPage()" style="width:100%;margin-top:10px;background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;">← Back to login</button>
        </div>
      </div>
    `;
    window.chatApp = this;
    document.getElementById('pin-0').focus();
  }

  pinInput(index) {
    const input = document.getElementById(`pin-${index}`);
    input.value = input.value.replace(/[^0-9]/g, '');
    if (input.value && index < 3) {
      document.getElementById(`pin-${index + 1}`).focus();
    }
    if (index === 3 && input.value) {
      this.verifyPin();
    }
  }

  pinKeydown(event, index) {
    if (event.key === 'Backspace' && !document.getElementById(`pin-${index}`).value && index > 0) {
      document.getElementById(`pin-${index - 1}`).focus();
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
      const response = await fetch(`${BACKEND}/api/verify-pin`, {
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
            <div class="channel-item" onclick="chatApp.switchChannel('class')">
              <span># class</span>
              <span class="notification-badge" id="class-badge" style="display: none;">0</span>
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
          <div class="input-area">
            <input type="text" id="message-input" placeholder="Type a message..." onkeypress="if(event.key==='Enter') chatApp.sendMessage()" oninput="chatApp.handleTyping()">
            <button class="send-btn" onclick="chatApp.sendMessage()">Send</button>
          </div>
        </div>
      </div>

      <div class="admin-panel" id="admin-panel">
        <div class="admin-header">
          <h2>⚙️ Admin Dashboard</h2>
          <button class="close-btn" onclick="chatApp.closeAdminPanel()">&times;</button>
        </div>
        <div class="admin-content">
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
  }

  // ============ SOCKET.IO CONNECTION ============
  connectSocket() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.socket = io(BACKEND, {
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

    this.socket.on('user_online', (data) => {
      this.updateActiveUsers(data.count);
    });

    this.socket.on('user_offline', (data) => {
      this.updateActiveUsers(data.count);
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
      const response = await fetch(`${BACKEND}/api/messages/${this.currentChannel}`, {
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

    const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

    clearTimeout(this.typingTimeout);
    this.socket.emit('typing_stop', this.currentChannel);

    this.socket.emit('send_message', {
      channel: this.currentChannel,
      text
    });

    input.value = '';
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
    document.title = count > 0 ? `(${count}) School Chat` : 'School Chat';

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
    ctx.fillText('✉', 16, 17);

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
    const activeDiv = document.getElementById('active-users');
    if (activeDiv) {
      const label = count === 1 ? 'member online' : 'members online';
      activeDiv.innerHTML = `<span class="online-indicator"></span> <strong>${count}</strong> ${label}`;
    }
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
      const response = await fetch(`${BACKEND}/api/admin/users`, {
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
          <div class="user-list-item-name">${user.username}</div>
          <div class="user-list-item-status">
            ${user.role === 'owner' ? '👑 Owner' : '👤 Student'} &nbsp;·&nbsp; PIN: ${user.pin_code ? '••••' : '⚠️ not set'}
          </div>
        </div>
        ${user.role !== 'owner' ? `<button class="delete-user-btn" onclick="chatApp.deleteUser(${user.id})">Delete</button>` : ''}
      </div>
    `).join('');
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
      const response = await fetch(`${BACKEND}/api/admin/users`, {
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
      const response = await fetch(`${BACKEND}/api/admin/users/${userId}`, {
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
    sessionStorage.clear();
    this.socket?.disconnect();
    this.showLoginPage();
  }
}

window.chatApp = new SchoolChatApp();
