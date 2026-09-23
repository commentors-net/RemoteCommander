# RemoteCommander Web — Single-Server Hosting Agent

**RemoteCommander Web** is the dedicated single-server edition of RemoteCommander, designed to be deployed directly on a Linux / cPanel hosting server.

Unlike the Desktop version (which manages multiple remote servers over OpenSSH), the Web edition lives on the server itself. It executes local operations directly on the server's filesystem (`public_html`), connects to WHM API 1 over local loopback (`https://127.0.0.1:2087`), and provides an operations AI assistant powered by `gpt-5-mini`.

---

## Key Features

1. **Host Overview & Real-Time Metrics:**
   * Direct CPU load averages (1m, 5m, 15m), RAM usage, and disk partition stats.
   * Server uptime and operating system kernel details.
   * WHM API 1 loopback status and version badge.

2. **AI Operations Assistant (`gpt-5-mini`):**
   * Natural language chat assistant with real-time streaming and reasoning trace.
   * Pre-equipped with local system, file, and cPanel tools:
     * `server__system_info` & `server__disk_usage`
     * `website__list_files`, `website__read_file`, `website__write_file`
     * `cpanel__whm_status`, `cpanel__list_accounts`, `cpanel__create_account`, `cpanel__service_status`

3. **Website File Explorer & Editor:**
   * Scoped safely to the website root (`public_html` or designated app directory).
   * Directory traversal protection.
   * In-browser code editing with automatic timestamped backups (`.bak.<timestamp>`) before saving.

4. **cPanel & WHM Administration:**
   * View all hosted accounts with domain names, packages, disk quotas, and suspension status.
   * Provision new cPanel accounts directly through the UI.
   * Monitor health of core server services (Apache, MySQL, Exim, cPanel).

5. **Standalone Web Security:**
   * Protected with password / session token authentication.

---

## Configuration (`.env`)

Create a `.env` file in the application directory:

```env
# Server Port (cPanel Passenger sets this automatically, default 3000)
PORT=3000

# Access Security
ADMIN_PASSWORD=your_secure_master_password
JWT_SECRET=super_secret_jwt_encryption_key

# cPanel & WHM API 1 Gateway (Local Loopback)
WHM_HOST=127.0.0.1
WHM_PORT=2087
WHM_API_TOKEN=your_whm_api_token_here

# OpenAI Assistant Configuration
OPENAI_API_KEY=sk-proj-your-openai-api-key
OPENAI_MODEL=gpt-5-mini

# Website Root Directory (Safe Scope)
WEBSITE_ROOT=/home/username/public_html
DATA_DIR=./data
```

---

## Development & Build Commands

From repository root:

```bash
# Start frontend development server with API proxy
npm run web:dev

# Build production bundle (client SPA + compiled Node.js backend)
npm run web:build

# Run production server
npm run web:start

# Run unit tests
npm --workspace=@remote-commander/web test
```

---

## Deploying to cPanel (Step-by-Step)

### Option A: Via cPanel "Setup Node.js App" (Recommended)
1. In your cPanel dashboard, search for **Setup Node.js App** (under *Software*).
2. Click **Create Application**:
   * **Node.js version:** Select `v20.x` or `v22.x` (or newer).
   * **Application mode:** `Production`.
   * **Application root:** `rc-web` (or folder of your choice under `/home/username/`).
   * **Application URL:** Select your domain/subdomain (e.g. `commander.yourdomain.com`).
   * **Application startup file:** `dist/server/index.js` (or `app.js`).
3. Upload the built `apps/web` files (including `dist/`, `package.json`, and `.env`).
4. Click **Run NPM Install** in cPanel.
5. Click **Restart Application**.
6. Access your URL in your browser: `https://commander.yourdomain.com`.

### Option B: Standalone Service with PM2 / Systemd
If running as a background service:
```bash
pm2 start dist/server/index.js --name "rc-web"
pm2 save
pm2 startup
```
Proxy requests via Apache/Nginx reverse proxy to `http://127.0.0.1:3000`.
