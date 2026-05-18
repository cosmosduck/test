# Deployment Guide - School Chat App

## Option 1: Railway.app (EASIEST - Recommended)

Railway is the easiest way to deploy and includes free PostgreSQL database.

### Step 1: Create Railway Account
1. Go to https://railway.app
2. Sign up with GitHub
3. Authorize Railway

### Step 2: Create New Project
1. Click "+ New Project"
2. Select "Deploy from GitHub repo"
3. Select `cosmosduck/test`

### Step 3: Add PostgreSQL Database
1. In Railway, click "+ Add"
2. Select "Add from marketplace"
3. Choose "PostgreSQL"
4. It will auto-connect to your app

### Step 4: Set Environment Variables
1. Go to your project settings
2. Add these variables:
   ```
   JWT_SECRET=your_super_secret_key_here
   OWNER_USERNAME=admin
   OWNER_PASSWORD=your_strong_password_here
   NODE_ENV=production
   ```
3. DATABASE_URL will be automatically set by Railway

### Step 5: Deploy
1. Push to GitHub (Railway auto-deploys)
2. Or manually trigger deploy in Railway dashboard
3. Your site will be live at: `https://yourproject.up.railway.app`

---

## Option 2: Heroku (Alternative)

### Step 1: Create Heroku Account
1. Go to https://heroku.com
2. Sign up
3. Install Heroku CLI

### Step 2: Add PostgreSQL
```bash
heroku addons:create heroku-postgresql:hobby-dev -a your-app-name
```

### Step 3: Set Environment Variables
```bash
heroku config:set JWT_SECRET=your_secret_key -a your-app-name
heroku config:set OWNER_USERNAME=admin -a your-app-name
heroku config:set OWNER_PASSWORD=your_password -a your-app-name
```

### Step 4: Deploy
```bash
git push heroku main
```

---

## Option 3: Self-Hosted (Advanced)

### Requirements
- VPS (DigitalOcean, Linode, AWS)
- Node.js 18+
- PostgreSQL
- PM2 or systemd

### Setup

1. **SSH into server**
   ```bash
   ssh root@your_server_ip
   ```

2. **Install Node.js**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **Install PostgreSQL**
   ```bash
   sudo apt-get install -y postgresql postgresql-contrib
   sudo systemctl start postgresql
   ```

4. **Create database**
   ```bash
   sudo -u postgres createdb school_chat
   ```

5. **Clone your repo**
   ```bash
   cd /opt
   git clone https://github.com/cosmosduck/test.git
   cd test
   npm install
   ```

6. **Create .env file**
   ```bash
   nano .env
   ```
   Add:
   ```
   PORT=5000
   JWT_SECRET=your_secret_key
   OWNER_USERNAME=admin
   OWNER_PASSWORD=your_password
   DATABASE_URL=postgresql://postgres:password@localhost:5432/school_chat
   NODE_ENV=production
   ```

7. **Install PM2 (keep app running forever)**
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name "school-chat"
   pm2 startup
   pm2 save
   ```

8. **Setup Nginx (optional but recommended)**
   ```bash
   sudo apt-get install -y nginx
   ```

---

## Local Development with PostgreSQL

### Mac/Linux

1. **Install PostgreSQL**
   ```bash
   brew install postgresql
   brew services start postgresql
   ```

2. **Create database**
   ```bash
   createdb school_chat
   ```

3. **Create .env file**
   ```
   PORT=5000
   JWT_SECRET=dev_secret_key
   OWNER_USERNAME=admin
   OWNER_PASSWORD=admin123
   DATABASE_URL=postgresql://localhost:5432/school_chat
   ```

4. **Run app**
   ```bash
   npm install
   npm start
   ```

### Windows

1. Download PostgreSQL from https://www.postgresql.org/download/windows/
2. Install with default settings
3. Open pgAdmin (comes with PostgreSQL)
4. Create new database: `school_chat`
5. Get connection string and add to `.env`
6. Run `npm start`

---

## Verify Database

### Check connection
```bash
psql $DATABASE_URL
```

### View tables
```sql
\dt
```

### View users
```sql
SELECT * FROM users;
```

### View messages
```sql
SELECT * FROM messages ORDER BY created_at DESC LIMIT 10;
```

---

## Backup Your Data

### Export database
```bash
pg_dump $DATABASE_URL > backup.sql
```

### Restore database
```bash
psql $DATABASE_URL < backup.sql
```

---

## Troubleshooting

**App not starting?**
- Check logs: `pm2 logs school-chat`
- Check DATABASE_URL is correct
- Run migrations: `node db.js`

**Database connection error?**
- Verify PostgreSQL is running
- Check DATABASE_URL syntax
- Verify database exists

**Messages not persisting?**
- Check database tables exist
- Verify user has database permissions
- Check logs for SQL errors
