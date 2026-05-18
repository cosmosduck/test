class SchoolChatApp {
  constructor() {
    this.token = localStorage.getItem('token');
    this.username = localStorage.getItem('username');
    this.userId = localStorage.getItem('userId');
    this.role = localStorage.getItem('role');
    this.currentChannel = 'general';
    this.socket = null;
    this.messages = { general: [], class: [] };
    this.notifications = { general: 0, class: 0 };
    this.activeUsers = [];

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
          <button class="login-btn" onclick="app.login()">Login</button>
        </div>
      </div>
    `;
    window.app = this;
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
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        errorDiv.textContent = 'Invalid credentials';
        return;
      }

      const data = await response.json();
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      localStorage.setItem('userId', data.userId);
      localStorage.setItem('role', data.role);

      this.token = data.token;
      this.username = data.username;
      this.userId = data.userId;
      this.role = data.role;

      this.showChatApp();
    } catch (error) {
      errorDiv.textContent = 'Login failed: ' + error.message;
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
            <div class="channel-item active" onclick="app.switchChannel('general')">
              <span># general</span>
              <span class="notification-badge" id="general-badge" style="display: none;">0</span>
            </div>
            <div class="channel-item" onclick="app.switchChannel('class')">
              <span># class</span>
              <span class="notification-badge" id="class-badge" style="display: none;">0</span>
            </div>
          </div>
          <div class="sidebar-footer">
            ${this.role === 'owner' ? '<button class="btn btn-primary" onclick="app.openAdminPanel()">👤 Admin</button>' : ''}
            <button class="btn btn-danger" onclick="app.logout()">Logout</button>
          </div>
        </div>

        <div class="main-content">
          <div class="chat-header">
            <h1># ${this.currentChannel}</h1>
            <div class="active-users" id="active-users"><span class="online-indicator"></span> Users online</div>
          </div>
          <div class="messages-container" id="messages"></div>
          <div class="input-area">
            <input type="text" id="message-input" placeholder="Type a message..." onkeypress="if(event.key==='Enter') app.sendMessage()">
            <button class="send-btn" onclick="app.sendMessage()">Send</button>
          </div>
        </div>
      </div>

      <div class="admin-panel" id="admin-panel">
        <div class="admin-header">
          <h2>⚙️ Admin Dashboard</h2>
          <button class="close-btn" onclick="app.closeAdminPanel()">&times;</button>
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
            <button class="btn btn-primary" onclick="app.createUser()" style="width: 100%;">Create User</button>
          </div>
          <div class="admin-section">
            <h3>Manage Users</h3>
            <div id="user-list"></div>
          </div>
        </div>
      </div>
    `;

    window.app = this;
    this.connectSocket();
    this.loadMessages();
    if (this.role === 'owner') this.loadUsers();
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ============ SOCKET.IO CONNECTION ============
  connectSocket() {
    this.socket = io({
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
      this.updateActiveUsers();
    });

    this.socket.on('user_offline', (data) => {
      this.updateActiveUsers();
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

  sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();

    if (!text) return;

    this.socket.emit('send_message', {
      channel: this.currentChannel,
      text
    });

    input.value = '';
  }

  addNotification(channel) {
    this.notifications[channel]++;
    const badge = document.getElementById(`${channel}-badge`);
    if (badge) {
      badge.textContent = this.notifications[channel];
      badge.style.display = 'flex';
    }
  }

  updateActiveUsers() {
    const activeDiv = document.getElementById('active-users');
    if (activeDiv) {
      activeDiv.innerHTML = `<span class="online-indicator"></span> Users online`;
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
          <div class="user-list-item-name">${user.username}</div>
          <div class="user-list-item-status">
            ${user.role === 'owner' ? '👑 Owner' : '👤 Student'}
          </div>
        </div>
        ${user.role !== 'owner' ? `<button class="delete-user-btn" onclick="app.deleteUser(${user.id})">Delete</button>` : ''}
      </div>
    `).join('');
  }

  async createUser() {
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;

    if (!username || !password) {
      alert('Please fill in all fields');
      return;
    }

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const error = await response.json();
        alert('Error: ' + error.error);
        return;
      }

      document.getElementById('new-username').value = '';
      document.getElementById('new-password').value = '';
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
    localStorage.clear();
    this.socket?.disconnect();
    this.showLoginPage();
  }
}

const app = new SchoolChatApp();
