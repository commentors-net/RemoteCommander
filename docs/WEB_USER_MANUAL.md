# RemoteCommander Web Edition — User Manual

**RemoteCommander Web Edition** is a single-server AI operations assistant designed to be deployed directly onto Linux / cPanel hosting environments. It enables operators and clients to manage website files, inspect server health, manage cPanel/WHM services, execute server/sudo commands via local SSH, and deploy updates through natural language with **one-click interactive responses**.

---

## Table of Contents

1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Login & Settings Setup](#2-login--settings-setup)
3. [Local Server SSH Execution (Root & Sudo Setup)](#3-local-server-ssh-execution-root--sudo-setup)
   - [Is SSH Required? (Fallback to WHM API & Built-In Tools)](#is-ssh-required-fallback-to-whm-api--built-in-tools)
   - [Why Loopback SSH?](#why-loopback-ssh)
   - [Option A: Direct `root` SSH Access (WHM Key Authorization)](#option-a-direct-root-ssh-access-whm-key-authorization)
   - [Option B: cPanel User with `sudo` Access (Recommended Best Practice)](#option-b-cpanel-user-with-sudo-access-recommended-best-practice)
4. [The Chat Interface & Interactive Engine](#4-the-chat-interface--interactive-engine)
5. [Interaction Trigger Matrix (AI Response ➔ UI Elements)](#5-interaction-trigger-matrix-ai-response--ui-elements)
6. [Real-World Walkthrough Scenarios](#6-real-world-walkthrough-scenarios)
   - [Scenario A: Uploading & Installing an Update Archive (`update-2026-v1.zip`)](#scenario-a-uploading--installing-an-update-archive-update-2026-v1zip)
   - [Scenario B: Resolving Path Confusion (`/home/username` vs Real Server Path)](#scenario-b-resolving-path-confusion-homeusername-vs-real-server-path)
   - [Scenario C: Inspecting Apache / Passenger Virtual Hosts & System Files](#scenario-c-inspecting-apache--passenger-virtual-hosts--system-files)
   - [Scenario D: Inspecting PM2 & Server Process Health](#scenario-d-inspecting-pm2--server-process-health)
   - [Scenario E: Attaching Screenshots & Error Images for Visual Diagnosis](#scenario-e-attaching-screenshots--error-images-for-visual-diagnosis)
   - [Scenario F: WHM / cPanel Management & Service Health](#scenario-f-whm--cpanel-management--service-health)
7. [Server-Side Persistence & Cross-Device Access](#7-server-side-persistence--cross-device-access)
8. [Security at Rest & Credentials Protection](#8-security-at-rest--credentials-protection)
9. [Troubleshooting & FAQ](#9-troubleshooting--faq)

---

## 1. System Overview & Architecture

RemoteCommander Web runs as a secure Node.js daemon (managed by cPanel Passenger, Systemd, or PM2) on your server.

```
┌─────────────────────────────────────────────────────────┐
│                      Web Browser                        │
│   (Desktop, Laptop, Mobile — Access from Any Location)   │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS / JWT Auth
┌───────────────────────────▼─────────────────────────────┐
│             RemoteCommander Web Backend                │
│             (Node.js Service on Server)                 │
├─────────────────────────────────────────────────────────┤
│ • Local System Tools (system_info, pm2_status, proc_list)│
│ • Safe Website File Engine (scoped to websiteRoot)      │
│ • Native Archive Engine (server.extract_zip)            │
│ • Loopback SSH Engine (127.0.0.1:22 for Root & Sudo)    │
│ • WHM API 1 Local Loopback Gateway                      │
│ • AES-256-GCM Encryption-At-Rest Storage                │
│ • Server-Side Chat & Execution Log Persistence          │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Login & Settings Setup

1. **Accessing the Web App**:
   Navigate to your installation URL (e.g. `https://yourdomain.com/commander` or `http://localhost:3000`).
2. **Authentication**:
   Enter your administrator password (default is `admin123`, customizable via the `ADMIN_PASSWORD` environment setting in `.env`).
3. **Configuring Settings Tabs**:
   Click the **Settings** tab in the sidebar:
   - **AI Provider (OpenAI)**: Enter your `sk-proj-...` API key. Select your model (default: `gpt-5-mini`).
   - **cPanel & WHM API 1 Token**: Enter your WHM API token and hostname (`127.0.0.1` or server domain like `server.yourdomain.com`).
   - **Local Server SSH Execution (Root / Sudo)**: Configure loopback SSH credentials for running server diagnostics and root/sudo tasks.
   - **Website Root Directory**: Path where website files live (default: `public_html` or `/home/cpaneluser/public_html`).
4. Click **Save Settings**. All credentials are automatically encrypted at rest using hardware-backed AES-256-GCM.

---

## 3. Local Server SSH Execution (Root & Sudo Setup)

### Is SSH Required? (Fallback to WHM API & Built-In Tools)

**No, SSH is completely optional.** 

RemoteCommander is fully functional without any SSH keys configured. The **WHM API Token** and **native Node.js engines** handle core administrative and website operations:

| Feature / Task | How It Works Without SSH | Tool Used |
|---|---|---|
| **cPanel / WHM Service Status** | Queries WHM API 1 via HTTPS on loopback port 2087 | `cpanel.service_status` |
| **List Domains & Hosted Accounts** | Queries WHM API 1 | `cpanel.list_accounts` |
| **Extracting Zip / Tar Archives** | Extracted natively by Node.js (no bash script needed!) | `server.extract_zip` |
| **Website File Management** | Reads, writes, lists files in `public_html` & home folder | `website.list_files`, `website.read_file`, `website.write_file` |
| **Server CPU / RAM / Uptime** | Queries native OS kernel metrics | `server.system_info` |
| **PM2 Process Health** | Queries Node.js process table | `server.pm2_status` |
| **Visual Error Diagnosis** | Analyzes uploaded screenshots with Multimodal AI | Multimodal vision engine |

#### What Happens When an SSH Command Is Attempted Without SSH Keys?
If a task specifically requires low-level terminal execution (e.g. running raw bash commands or inspecting `/etc/apache2/` virtual hosts outside the website root):
1. The tool returns a clean, non-crashing error badge:
   ```text
   Tool: server.ssh_execute (failed)
   Error: Local SSH execution is not configured or is disabled. Shell/SSH commands cannot be executed until SSH is enabled in Settings > Local Server SSH Execution and an authorized key is configured.
   ```
2. The AI assistant immediately explains to the user:
   - That direct terminal/SSH execution is currently disabled.
   - What alternatives are available right now (e.g. checking `.htaccess` inside `public_html` or querying WHM API).
   - How they can enable SSH in **Settings &rarr; Local Server SSH Execution** if they want deep terminal access.

---

### Why Loopback SSH?

When RemoteCommander is hosted on the same server it manages, establishing an SSH session to `127.0.0.1` gives the AI assistant powerful capabilities while maintaining strict security:
- **Inspect Apache / Passenger Virtual Hosts**: Access `/etc/apache2/` and Passenger routing configurations that live outside the website root.
- **Service Diagnostics**: Check system service statuses (`systemctl status httpd`, `systemctl status mysqld`) and system logs (`/var/log/messages`).
- **Complete Isolation**: Because the connection is over loopback (`127.0.0.1`), no inbound ports need to be opened to the public internet.

RemoteCommander Web supports two flexible authorization models:

---

### Option A: Direct `root` SSH Access (WHM Key Authorization)

Use this method if your server allows root login via SSH key pairs.

1. Open RemoteCommander Web &rarr; **Settings** &rarr; **Local Server SSH Execution (Root / Sudo)**.
2. Check **Enable Local SSH Command Execution**.
3. Verify settings:
   - **SSH Host**: `127.0.0.1`
   - **SSH Port**: `22` (or your custom SSH port if modified in `/etc/ssh/sshd_config`)
   - **SSH User**: `root`
4. Click **[Generate Key Pair]**. RemoteCommander generates an RSA-2048 key pair formatted specifically for OpenSSH and WHM.
5. Click **[Copy Public Key]**.
6. Log into **WHM** as `root`:
   - Navigate to **Security Center** &rarr; **Manage root’s SSH Keys**.
   - Click **Import Key**.
   - In the **Public Key** box, paste the copied key string.
   - Give it a recognizable name (e.g. `remote-commander-web`).
   - Click **Import**.
   - Under the **Public Keys** table, locate `remote-commander-web`, click **Manage Authorization**, and click **Authorize**.
7. Return to RemoteCommander Web:
   - Click **Save Settings**.
   - Click **[Test Connection]**. A green notification confirming `Logged in as root on 127.0.0.1:22` will appear.

---

### Option B: cPanel User with `sudo` Access (Recommended Best Practice)

Use this method if direct root login is disabled on your server (`PermitRootLogin no`), or you follow the principle of least privilege.

#### Step 1: Import Key into cPanel
1. In RemoteCommander Web **Settings**, click **[Generate Key Pair]** and **[Copy Public Key]**.
2. Log into **cPanel** for the target account (e.g. `cpaneluser`).
3. Navigate to **SSH Access** (under *Security*) &rarr; **Manage SSH Keys** &rarr; **Import Key**.
4. Paste the public key string into the **Public Key** field and click **Import**.
5. Back on the Manage SSH Keys page, click **Manage Authorization** next to the key and click **Authorize**.

#### Step 2: Enable Shell Access for the Account
1. In **WHM** (as root), navigate to **Account Functions** &rarr; **Modify an Account**.
2. Select the cPanel account (`cpaneluser`).
3. Change **Shell Access** from *No Shell* or *Jailed Shell* to **Normal Shell** (`/bin/bash`).
4. Click **Save**.

#### Step 3: Grant `sudo` Privileges
Because the AI assistant executes non-interactively without prompting for a terminal password, configure passwordless sudo:

- In your server root terminal, create a sudoers rule file at `/etc/sudoers.d/remote-commander`:
  ```bash
  cpaneluser ALL=(ALL) NOPASSWD: ALL
  ```
  *(Or restrict to specific maintenance commands)*:
  ```bash
  cpaneluser ALL=(ALL) NOPASSWD: /usr/sbin/apachectl, /usr/bin/systemctl, /usr/bin/stat, /bin/ls, /bin/cat
  ```
- Set required file permissions:
  ```bash
  chmod 440 /etc/sudoers.d/remote-commander
  ```

#### Step 4: Configure RemoteCommander Web
1. In **Settings** &rarr; **Local Server SSH Execution**, set **SSH User** to your cPanel username (e.g. `cpaneluser`).
2. Click **Save Settings**.
3. Click **[Test Connection]**. RemoteCommander will verify the SSH handshake and display the active user identity.

---

## 4. The Chat Interface & Interactive Engine

The chat view is designed for **minimum typing and rapid operations**:

- **System Reasoning Trace Box**: Displays the AI's internal thought process. Click the toggle to expand or collapse diagnostics.
- **Tool Badges**: Real-time indicators of tool execution (e.g. `Tool: server.ssh_execute`, `Tool: server.extract_zip`). Green indicates success; red highlights errors with expandable error messages.
- **Attachment Tray**: Click the paperclip icon (`📎`) to attach error screenshots, log files, or code files.
- **Interactive Action Bar**: Appears immediately below assistant messages whenever choices, paths, or confirmations are needed.
- **One-Choice Selection Lock**: When an option is clicked, it is submitted immediately and other options are locked to prevent duplicate or conflicting executions.
- **Sessions Drawer (`≡ Sessions`)**: Slide-out menu to view past chats, switch sessions, or start new operations across browsers.

---

## 5. Interaction Trigger Matrix (AI Response ➔ UI Elements)

The assistant dynamically evaluates user prompts and server state. When specific patterns occur, the web interface automatically renders interactive UI elements:

| Assistant Response Pattern | Detected Intent | Generated Interactive UI | User Action (Zero Typing) |
|---|---|---|---|
| `[Option A: Extract...]`<br>`[Option B: Inspect...]` | Explicit decision menu | **Clickable Choice Chips** (`secondary` blue styling) | Clicking any chip sends that exact option immediately. |
| `Option A — Check server`<br>`Reply "yes — check /home/..."` | Natural bulleted options with reply quotes | **Action Chips with Exact Payload** (e.g. `[ ↳ Option A: Check server ]`) | Clicking the chip sends the exact quoted payload without typing. |
| `[Yes, proceed]`<br>`[No, cancel]` | Approval / Confirmation prompt | **Dual Confirmation Buttons**:<br>• Green (`primary`): `Yes, proceed`<br>• Red (`danger`): `No, cancel` | Click green to confirm or red to abort. |
| `[Use Website Root: ...]`<br>`[Use Account Home: ...]` | Server path options or directory resolution | **Path Selection Chips** with full resolved Linux paths | Click to select and run against that target folder. |
| **3 or more options** or multiple paths | Multiple choices | **Dropdown Selector (`<select>`)** + **`Apply & Send`** Button | Select from dropdown menu and click Apply. |
| Pencil Icon (`✎`) next to any choice | User customization | **Edit / Pre-fill Button** | Copies the choice value into the input field and focuses the cursor for tweaking. |
| File / Image attached by user | Vision / Document evaluation | **Attachment Preview Card** (clickable image lightbox + file size badges) | Sent alongside prompt for visual analysis. |

---

## 6. Real-World Walkthrough Scenarios

### Scenario A: Uploading & Installing an Update Archive (`update-2026-v1.zip`)

#### The Situation
A client uploads an update archive `update-2026-v1.zip` to the cPanel account root (`/home/cpaneluser/`) and wants the chat assistant to install it into `public_html`.

#### How to Interact
1. **User Prompt**:
   > *"I uploaded update-2026-v1.zip to my account root. Please install it."*
2. **What the Assistant Does**:
   - Calls `website.list_files` to verify the archive exists in `/home/cpaneluser`.
   - Recognizes that extracting an archive modifies live files.
   - Responds with interactive choices:
     ```text
     I found "update-2026-v1.zip" (2.4 MB) in /home/cpaneluser. 
     Where would you like to extract this update?

     [Option A: Extract into public_html]
     [Option B: Extract into public_html/staging first]
     [No, cancel]
     ```
3. **Interactive UI Displayed**:
   ```text
   ┌──────────────────────────────────────────────────────────────┐
   │ ⚡ INTERACTIVE RESPONSE (CLICK TO SEND)                       │
   │                                                              │
   │ [ ↳ Option A: Extract into public_html        | ✎ ]          │
   │ [ ↳ Option B: Extract into staging first     | ✎ ]          │
   │ [ ↳ No, cancel                               | ✎ ]          │
   └──────────────────────────────────────────────────────────────┘
   ```
4. **User Action**: Click **`Option A: Extract into public_html`**.
5. **Execution**: The assistant immediately calls `server.extract_zip` with `{ archivePath: "update-2026-v1.zip", destination: "public_html" }` and reports:
   > *✓ Successfully extracted `update-2026-v1.zip` into `/home/cpaneluser/public_html`.*

---

### Scenario B: Resolving Path Confusion (`/home/username` vs Real Server Path)

#### The Situation
The user read a tutorial that uses the placeholder `/home/username/public_html`, but on this specific server the actual username is `cpaneluser`.

#### How to Interact
1. **User Prompt**:
   > *"Check if my config file is in /home/username/public_html/wp-config.php"*
2. **What the Assistant Does**:
   - Detects the placeholder `/home/username`.
   - Identifies the real server environment:
     - Account Home: `/home/cpaneluser`
     - Website Root: `/home/cpaneluser/public_html`
   - Formulates a corrective response:
     ```text
     On this server, your actual cPanel username is "cpaneluser". 
     The path "/home/username" does not exist here. Which directory would you like me to inspect?

     [Use Website Root: /home/cpaneluser/public_html]
     [Use Account Home: /home/cpaneluser]
     [Use App Folder: /home/cpaneluser/commander]
     ```
3. **Interactive UI Displayed**:
   ```text
   ┌──────────────────────────────────────────────────────────────┐
   │ ⚡ INTERACTIVE RESPONSE (CLICK TO SEND)                       │
   │                                                              │
   │ [ ↳ Use Website Root: /home/cpaneluser/public_html | ✎ ]     │
   │ [ ↳ Use Account Home: /home/cpaneluser             | ✎ ]     │
   │                                                              │
   │ ──────────────────────────────────────────────────────────── │
   │ Or select from dropdown:                                     │
   │ [ Use Website Root: /home/cpaneluser/public_html ▼ ] [Apply & Send]
   └──────────────────────────────────────────────────────────────┘
   ```
4. **User Action**: Click **`Use Website Root`** or select from the dropdown and click **`Apply & Send`**.

---

### Scenario C: Inspecting Apache / Passenger Virtual Hosts & System Files

#### The Situation
You want to inspect how Apache or Passenger routes web requests (e.g. identifying which virtual host is routing `/commander` on port 2087/443).

#### How to Interact
1. **User Prompt or Option Click**:
   > *"Option A: Inspect Apache/Passenger virtual host (WHM/cPanel) — find vhost that routes /commander"*
2. **Why the Website File Tool Cannot Access This**:
   - Apache virtual host configurations live in `/etc/apache2/conf/httpd.conf` or `/etc/apache2/conf.d/userdata/`.
   - The standard `website.read_file` tool is sandboxed to the website root (`public_html`) and will reject paths outside it with `Access Denied: Path outside allowed roots`.
3. **What the Assistant Does with SSH Enabled**:
   - Automatically utilizes the `server.ssh_execute` tool over loopback (`127.0.0.1`).
   - Runs root or sudo read-only inspection commands (e.g. `httpd -S` or `grep -rn "commander" /etc/apache2/`).
   - Formats a comprehensive report of the virtual host routing, Passenger app root, and port bindings.

---

### Scenario D: Inspecting PM2 & Server Process Health

#### The Situation
You want to verify if your Node.js apps or background workers are running properly under PM2.

#### How to Interact
1. **User Prompt**:
   > *"Can you check on the server, what is the status of PM2 and how many applications are running under it?"*
2. **What the Assistant Does**:
   - Calls `server.pm2_status`.
   - Returns a structured status report:
     - Total managed applications
     - Online / Stopped / Errored breakdown
     - Individual app names, PIDs, memory usage, and uptime
   - If an application is stopped or errored, it provides one-click action options:
     ```text
     [Restart Application: commander]
     [Inspect Error Logs (tail 50)]
     ```

---

### Scenario E: Attaching Screenshots & Error Images for Visual Diagnosis

#### The Situation
A website visitor reports a `500 Internal Server Error` or broken layout, and you have a screenshot of the error page.

#### How to Interact
1. **User Action**:
   - Click the paperclip icon (`📎`) in the bottom left of the input bar.
   - Select your screenshot (e.g. `error_screenshot.png`).
   - Type a prompt or leave it blank: *"Why is this page failing?"*
2. **What the Assistant Does**:
   - Transmits the screenshot to the multimodal AI engine.
   - Analyzes the visual error message (e.g. identifying a missing PHP extension or database connection string error).
   - Automatically cross-checks server logs using `server.system_info`, `server.ssh_execute`, or `website.read_file` to confirm the cause.
   - Recommends the fix with one-click approval buttons.

---

### Scenario F: WHM / cPanel Management & Service Health

#### The Situation
Checking if Apache, MySQL, Exim, or cPanel services are active and healthy.

#### How to Interact
1. **User Prompt**:
   > *"Check cPanel service status and list all hosted domains."*
2. **What the Assistant Does**:
   - Calls `cpanel.service_status` over local loopback (`https://127.0.0.1:2087`).
   - Calls `cpanel.list_accounts`.
   - Displays service health (HTTP, MySQL, Exim) and account quotas.

---

## 7. Server-Side Persistence & Cross-Device Access

RemoteCommander Web maintains **server-side persistence** for all chats and diagnostics:

1. **Storage Location**:
   - Chat sessions and logs are saved on the server filesystem at [`apps/web/data/sessions/<id>.json`](file:///D:/Jobs/workspace/RemoteCommander/apps/web/data/sessions/).
2. **Cross-Browser Synchronization**:
   - If you start a diagnostic conversation from your desktop at the office and later open the web app on your phone or home laptop, click the **Sessions** drawer (`≡ Sessions`).
   - All past conversations, reasoning traces, and tool logs load immediately.
3. **Manual Refresh**:
   - The Sessions drawer includes a **Refresh** button (`🔄`) to immediately pull newly created sessions if another operator is active.

---

## 8. Security at Rest & Credentials Protection

All sensitive credentials stored on the server are locked with **AES-256-GCM authenticated encryption**:

1. **Encryption-At-Rest ([`data/settings.json`](file:///D:/Jobs/workspace/RemoteCommander/apps/web/data/settings.json))**:
   - OpenAI API keys, WHM tokens, SSH private keys, and passphrases are stored as encrypted ciphertexts:
     ```json
     {
       "whmHost": "server.yourdomain.com",
       "whmPort": 2087,
       "whmToken": "enc:v1:344c10...:eab8...:2a61...",
       "openaiApiKey": "enc:v1:aa6756...:1e35...:be5d...",
       "sshEnabled": true,
       "sshHost": "127.0.0.1",
       "sshPort": 22,
       "sshUsername": "root",
       "sshPrivateKey": "enc:v1:8f2a...:91bc...:d441...",
       "websiteRoot": "public_html"
     }
     ```
   - Anyone opening `settings.json` in cPanel File Manager or downloading a server backup cannot read the plaintext keys.
2. **Browser Protection**:
   - API endpoints (`GET /api/settings`) never return raw keys or private keys to the browser. Only boolean status flags (`hasOpenaiKey: true`, `hasWhmToken: true`, `hasSshKey: true`) are transmitted.
3. **Git Protection**:
   - The entire `apps/web/data/` folder and secret keys are in `.gitignore`. Secrets can never be accidentally committed to Git.

---

## 9. Troubleshooting & FAQ

### Q: Why did the AI tool fail with "Access Denied: Path outside allowed roots"?
**A**: The `website.read_file` and `website.list_files` tools are intentionally sandboxed to the website root (`public_html`) and user home directory for web security. They are blocked from reading system configuration directories like `/etc/apache2/`, `/etc/nginx/`, or `/var/log/`.

**Resolution**:
Enable **Local Server SSH Execution** in **Settings**. When local SSH is configured (as `root` or a `sudo` cPanel user), the AI assistant will automatically use `server.ssh_execute` for system files, giving you full inspection capability while preserving web root safety.

---

### Q: Can the web assistant execute shell commands and scripts?
**A**: Yes! With **Local Server SSH Execution** enabled in Settings:
- The assistant can execute commands, query system packages, check virtual hosts, and run maintenance tasks over loopback `127.0.0.1`.
- For archive operations (`.zip`, `.tar.gz`), the assistant can also extract them directly using the native `server.extract_zip` tool without needing bash scripts.

---

### Q: Why do the other options disappear once I click an option chip?
**A**: When you click an interactive option chip or button, RemoteCommander immediately locks and submits that selection to prevent accidental double-clicks or conflicting operations. If you need to explore a different option, simply tell the assistant in your next message.

---

### Q: What if I want to customize an option before sending it?
**A**: Click the small **pencil icon (`✎`)** right next to any option button. This places the option text into your input bar and focuses the cursor, allowing you to edit the path, add flags, or include custom notes before pressing Send.

---

### Q: Will RemoteCommander still work if SSH keys are NOT configured?
**A**: **Yes, absolutely!** RemoteCommander relies primarily on the **WHM API Token** and the **built-in Node.js engines**. You do not need to configure SSH keys for day-to-day website management, extracting archives, viewing server health, or checking WHM services.

If you or the AI assistant attempt an operation that requires raw shell access (such as reading `/etc/apache2/` configs), the system simply displays:
```text
Tool: server.ssh_execute (failed)
Error: Local SSH execution is not configured or is disabled.
```
The AI will gracefully fall back to available tools (like WHM API or website root files) and inform you that SSH can optionally be configured in Settings.
