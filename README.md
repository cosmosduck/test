# 🎓 School Chat Application

A real-time chat application for schools with owner dashboard, user management, and instant notifications.

## Features

✅ **Authentication System**
- Login wall with username/password
- Owner-only user credential management
- JWT token-based authentication

✅ **Chat Channels**
- **#general** - School-wide chat
- **#class** - Class-specific chat
- Real-time messaging with Socket.io

✅ **Notifications**
- Instant notifications when messages arrive
- Browser notifications support
- Message count badges

✅ **Owner Dashboard**
- Create new user credentials
- Delete any user account
- View online/offline status
- User management interface

✅ **User Features**
- Multiple channel support
- Message history
- Online user indicator
- Real-time message delivery

## Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file:
```env
PORT=5000
JWT_SECRET=your_super_secret_jwt_key_change_this
OWNER_USERNAME=admin
OWNER_PASSWORD=change_me_to_strong_password
```

### 3. Start the Server
```bash
npm start
```

Server runs on `http://localhost:5000`

## Usage

### Owner Login
1. Go to `http://localhost:5000`
2. Login with your owner credentials (default: admin/change_me_to_strong_password)
3. Click **👤 Admin** to open the dashboard

### Create User
1. In Admin Dashboard → "Create New User"
2. Enter username and password
3. Click "Create User"
4. Share credentials with student

### Delete User
1. In Admin Dashboard → "Manage Users"
2. Find the user
3. Click "Delete" button

### Chat
1. Students login with their credentials
2. Switch between **#general** and **#class** channels
3. Type message and press Enter or click Send
4. Receive notifications for new messages

## Architecture

```
┌─────────────┐
│   Browser   │ (HTML/CSS/JavaScript)
├─────────────┤
│  Socket.io  │ (Real-time communication)
├─────────────┤
│  Express    │ (REST API)
├─────────────┤
│  Node.js    │ (Backend server)
└─────────────┘
```

## File Structure

```
.
├── server.js              # Main backend server
├── package.json           # Dependencies
├── .env.example           # Environment template
├── public/
│   ├── index.html         # Frontend HTML
│   ├── app.js             # Frontend JavaScript
│   └── style.css          # Frontend styles
└── README.md              # This file
```

## API Endpoints

### Authentication
- `POST /api/login` - User login

### Messages
- `GET /api/messages/:channel` - Get message history

### Admin (Owner only)
- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Create new user
- `DELETE /api/admin/users/:userId` - Delete user

## Socket.io Events

### Client → Server
- `join_channel` - Join a chat channel
- `send_message` - Send a message
- `disconnect` - User disconnects

### Server → Client
- `receive_message` - New message received
- `user_joined` - User joined channel
- `user_online` - User came online
- `user_offline` - User went offline
- `notification` - Message notification

## Security Notes

⚠️ **This is a basic implementation. For production:**
- Store passwords in a database with bcrypt hashing ✓ (already implemented)
- Use HTTPS instead of HTTP
- Implement rate limiting
- Add input validation and sanitization
- Use a proper database (MongoDB, PostgreSQL)
- Implement message encryption
- Add audit logging
- Use environment variables for secrets

## Troubleshooting

**Can't connect to server?**
- Verify Node.js is running
- Check PORT in .env
- Ensure all dependencies are installed

**Messages not sending?**
- Check browser console for errors
- Verify token is valid
- Check Socket.io connection

**Owner dashboard not loading?**
- Verify role is 'owner'
- Check authentication token

## License
MIT
