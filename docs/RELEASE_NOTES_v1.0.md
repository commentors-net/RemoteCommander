# RemoteCommander v1.0.0 — Production Release Notes

**Release Version:** `1.0.0`  
**Release Date:** September 20, 2026  
**Status:** General Availability (GA) — Production Ready  
**Distribution Channel:** Stable  
**Architecture:** Tauri 2.0 + React 18 + Rust Native Core + SQLite

---

## 1. Executive Summary

RemoteCommander v1.0.0 is the official, stable general-availability release of the **Secure Desktop AI Operations Assistant**. Engineered specifically for system administrators, DevOps engineers, and hosting providers managing remote Linux fleets and WHM/cPanel environments, RemoteCommander combines local-first authority with intelligent multi-provider AI orchestration.

RemoteCommander is fundamentally designed around a zero-trust model toward AI agents: **the desktop application owns authority; the model proposes and reasons, while the local native Rust runtime validates, authorizes, executes, records, and recovers.**

---

## 2. Core Architectural Pillars

### Local-First & Sovereign

- **Zero Mandatory Cloud Relays:** All SSH and SFTP connections are opened directly from your workstation to your remote servers. No server credentials, SSH keys, or server outputs ever pass through intermediary cloud infrastructure.
- **Local Persistence:** Server inventories, settings, session states, and audit trails are persisted strictly on your workstation in a local SQLite database (`remote_commander.db`).
- **Air-Gapped & Offline Ready:** Full support for local offline AI inference via Ollama (`127.0.0.1:11434`), enabling completely private, air-gapped system operations with zero external data transmission.

### The Immutable Native Security Core

- **Out-of-Context Policy Engine:** Tool policies, privilege evaluation, and risk tiers execute strictly within the native Rust backend, entirely isolated from LLM prompt context or frontend script modification.
- **Hardware-Backed Keyring Storage:** Sensitive credentials (API keys, SSH passphrases, WHM tokens) are stored in the host operating system's native secure credential manager (Windows Credential Manager, macOS Keychain, Linux Secret Service via FreeDesktop DBus).
- **Append-Only SQLite Audit Trail:** Every tool call proposal, argument set, security decision, human approval, and execution output is recorded to an immutable local audit log.

---

## 3. Cross-Milestone Security Gates Sign-Off

RemoteCommander v1.0 has satisfied all 7 Cross-Milestone Security Gates defined in Master Specification §21 and §26:

| Security Gate                     | Description                                                                   | Enforcement Mechanism                                                                               |   Status   |
| --------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | :--------: |
| **Gate A: Secrets Isolation**     | Zero plaintext secrets in database, prompts, logs, or UI storage.             | Rust `keyring` crate; automatic regex secret redaction in logs and AI message buffers.              | **PASSED** |
| **Gate B: Target Identity**       | Remote state-changing operations require deterministic server identification. | Mandatory `server_id` resolution; prevents ambient or wrong-server execution bugs.                  | **PASSED** |
| **Gate C: Immutable Auditing**    | All privileged tool executions emit structured audit records.                 | Append-only SQLite `audit_events` table with timestamps, user decisions, and execution status.      | **PASSED** |
| **Gate D: Model Authority**       | The AI model never authorizes its own actions or bypasses policy.             | Native Rust policy engine evaluates risk tiers (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) independently. | **PASSED** |
| **Gate E: Host Key Verification** | Direct SSH host identity verified prior to authentication.                    | `StrictHostKeyChecking` semantics by default; visual fingerprint confirmation for unknown keys.     | **PASSED** |
| **Gate F: Cancellation**          | Long-running operations expose responsive cooperative cancellation.           | `CancellationToken` and process termination hooks across SSH sessions and file transfers.           | **PASSED** |
| **Gate G: Untrusted Data**        | Remote outputs cannot hijack LLM instructions or escalate privileges.         | Rigid `<<< UNTRUSTED EXTERNAL DATA >>>` boundary encapsulation neutralizing prompt injection.       | **PASSED** |

---

## 4. Comprehensive Feature Overview

### 4.1. Intelligent Operations & AI Orchestration (M4, M13, M14, M17)

- **Multi-Provider Support:** First-class integrations for:
  - **OpenAI:** GPT-4o, GPT-4o-mini, o1, o3-mini.
  - **Anthropic:** Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus.
  - **Google Gemini:** Gemini 2.0 Flash, Gemini 1.5 Pro.
  - **Ollama (Local):** DeepSeek-R1, Qwen 2.5 Coder, Llama 3.3, Mistral.
- **Automated Fallback Chain:** Resilient fallback to secondary providers on transient HTTP 429 rate limits or network connection timeouts without interrupting operational workflow.
- **Untrusted External Data Wrapping:** Remote stdout, stderr, syslog entries, and file contents are bounded before insertion into model context, preventing prompt injection attacks.
- **Zero-Data-Leak Telemetry Policy:** Explicit provider disclosures inform the operator if prompts leave the local workstation.

### 4.2. Fleet Inventory & Direct SSH Transport (M5, M6, M7)

- **Server Profiles:** Manage unlimited server profiles with tags, custom SSH ports, non-root users, identity files, and sudo credentials.
- **Native OpenSSH Engine:** Direct transport leveraging system OpenSSH with strict cryptographic host key verification.
- **Embedded Interactive Terminal:** High-performance xterm.js terminal with WebGL/Canvas acceleration backed by a native Rust PTY (portable-pty) for manual shell access.
- **Streaming Remote Execution:** Real-time stdout/stderr streaming with ANSI escape sequence support and cancellation controls.

### 4.3. Remote File Management & Safety Layer (M8, M9)

- **SFTP Explorer:** Full directory browsing, attribute inspection, search, and drag-and-drop file upload/download.
- **Atomic Pre-Modification Backups:** Automatic timestamped backups (`.bak.YYYYMMDD_HHMMSS`) created before the assistant or operator writes or overwrites remote configuration files.
- **Rollback Helper:** Single-click rollback of modified files to previous snapshots.
- **Destructive Command Heuristics:** Automated pattern analysis detecting high-risk commands (e.g., `rm -rf /`, `mkfs`, `fdisk`, `DROP DATABASE`) requiring typed server name confirmation.

### 4.4. Semantic Server Operations & Linux Distro Matrix (M10, M17)

- **Service Management:** Start, stop, restart, enable, disable, and reload systemd units and SysV init daemons.
- **System Health Diagnostics:** Structured inspection of CPU load, memory utilization, disk partitions, and active TCP/UDP network connections.
- **Log Streaming & Tailing:** Real-time log inspection (`journalctl`, `/var/log/messages`, `/var/log/syslog`, `/var/log/nginx/error.log`) with search and filtering.
- **Distro Compatibility Engine:** First-class multi-family Linux support:
  - **AlmaLinux 9 / 8** (RHEL family: `dnf`/`yum`, `/var/log/messages`, `httpd`, `mariadb`)
  - **Rocky Linux 9 / 8** (RHEL family: `dnf`/`yum`, `/var/log/messages`, `httpd`, `mariadb`)
  - **CloudLinux 9 / 8** (RHEL family: `dnf`/`yum`, CageFS, LVE Manager, `httpd`, `mariadb`)
  - **Ubuntu 24.04 / 22.04 LTS** (Debian family: `apt`, `/var/log/syslog`, `apache2`, `mysql`)
  - **Debian 12 / 11** (Debian family: `apt`, `/var/log/syslog`, `apache2`, `mariadb`)

### 4.5. WHM / cPanel Server Management (M11)

- **Native WHM API v1 & UAPI:** Direct integration with WHM management endpoints via API tokens or root authentication.
- **Account Administration:** List accounts, inspect disk/bandwidth quotas, suspend/unsuspend accounts with documented audit reasons.
- **DNS & Domain Management:** Enumerate zones, inspect DNS records, and diagnose domain routing.
- **Hosting Service Controls:** Restart cPanel services (`cpanel`, `whostmgr`, `cpsrvd`, `dovecot`, `named`, `pure-ftpd`).
- **SSL Status & AutoSSL Monitoring:** Real-time certificate expiry verification and AutoSSL queue status inspection.

### 4.6. Multi-Server Diagnostics (M12)

- **Parallel Read Sweeps:** Query disk utilization, memory pressure, active service status, or security updates across multiple servers simultaneously.
- **Aggregate Summary:** AI-assisted comparison of health metrics across production, staging, and disaster recovery clusters.
- **Isolated State Protection:** Write operations remain strictly scoped to single, explicitly confirmed server targets.

### 4.7. Packaging, Supply Chain & SQLite Maintenance (M15, M17)

- **Ed25519 Cryptographic Updates:** Official update manifest validation using Ed25519 signatures preventing malicious or corrupted binary updates.
- **Software Bill of Materials (SBOM):** Standardized CycloneDX v1.5 SBOM generation detailing all native Rust dependencies and NPM frontend packages.
- **Database Self-Healing:** Integrated `PRAGMA integrity_check`, foreign key validation, and automated SQLite `VACUUM` for index optimization and defragmentation.

---

## 5. Security & Verification Summary

| Verification Area                  |         Result         | Notes                                                                          |
| ---------------------------------- | :--------------------: | ------------------------------------------------------------------------------ |
| **TypeScript Test Suite**          |  **135 / 135 Passed**  | 100% pass rate across `ai-core`, `shared-types`, `tool-schema`, and `desktop`. |
| **Rust Native Test Suite**         |   **88 / 88 Passed**   | 100% pass rate across crypto, policy, updater, sftp, and database modules.     |
| **ESLint & Prettier**              |  **Clean (0 errors)**  | Strict linting conformance across all workspaces.                              |
| **Cargo Clippy & Rustfmt**         | **Clean (0 warnings)** | Built with `-D warnings` on Rust 1.80+.                                        |
| **Secret Leak Scanner**            |       **Passed**       | Zero hardcoded keys, passwords, or tokens in repository.                       |
| **Ed25519 Signature Verification** |      **Verified**      | Manifest signature and SHA-256 payload integrity confirmed.                    |

---

## 6. Quickstart Operator Guide

### 1. Installation

Download the official installer for your operating system:

- **Windows:** `RemoteCommander-Setup-1.0.0.exe` (NSIS) or `.msi`
- **macOS:** `RemoteCommander-1.0.0.dmg` (Universal binary for Apple Silicon and Intel)
- **Linux:** `RemoteCommander-1.0.0.AppImage` or `.deb` / `.rpm`

### 2. Configure AI Provider

1. Launch RemoteCommander and navigate to **Settings** (`Ctrl+,` or cog icon).
2. Select your preferred AI Provider:
   - **Local Inference (Zero-Cloud):** Choose **Ollama**, verify connection to `http://127.0.0.1:11434`, and select your local model (e.g. `deepseek-r1:8b` or `qwen2.5-coder:7b`).
   - **Cloud Providers:** Enter your API key for OpenAI, Anthropic, or Gemini. The key is instantly encrypted and saved to your OS Keyring.
3. Configure your **Fallback Provider** (e.g., Anthropic or Ollama) to ensure continuous operation during rate limits.

### 3. Add Remote Servers

1. Navigate to the **Servers** tab and click **Add Server**.
2. Enter the hostname/IP, SSH port (default `22`), and username.
3. Select authentication method (SSH Key or Password) and save credentials to the OS Keyring.
4. If managing a cPanel server, enable **WHM Integration** and provide the WHM API token.

### 4. Choose Permission Mode

Set the operational authority tier appropriate for your session:

- **Safe Automation (Default):** Read operations run autonomously; write operations prompt for approval.
- **Prompt Confirmation:** All tool actions require single-click approval.
- **Strict Approval:** High-risk actions require typed server confirmation.
- **Full Access (Time-Limited):** Autonomous operations for batch maintenance, auto-expiring after 15, 30, or 60 minutes with full audit recording.

---

## 7. Operational Safety Rules & Invariants

1. **Verify Server Identity:** Always confirm the active server tag before approving high-impact operations.
2. **Review Destructive Prompts:** Never bypass typed server name confirmations for `CRITICAL` risk tier operations.
3. **Backup Before Edit:** Leverage the built-in automatic backup engine before executing configuration adjustments.
4. **Inspect Audit History:** Regularly review the **Activity** tab to verify all operations performed across your fleet.

---

_RemoteCommander v1.0.0 is released under the MIT License._  
_Copyright © 2026 RemoteCommander Team._
