# RemoteCommander: Private Alpha Validation & Test Plan (Milestone M16)

> **Document Context**: Authoritative baseline defined in Master Specification §19 (Milestone M16), §51, §102, and §26.
> This document guides early alpha testers and operators through production-like testing across personally controlled, staging, and non-critical hosting infrastructure.

---

## 1. Alpha Scope & Objectives

The primary objective of the **Private Alpha** is to validate RemoteCommander under authentic system administration conditions with zero data loss and zero security compromises.

### Recommended Infrastructure Scope

1. **Personal / Homelab Nodes**: Raspberry Pi, homelab servers, or local virtual machines.
2. **Staging & QA Servers**: Cloud VPS instances (AlmaLinux, Rocky Linux, Ubuntu, Debian) hosting staging workloads.
3. **Non-Critical cPanel / WHM Servers**: Shared hosting or reseller testing environments.
4. **Production Servers**: Restricted strictly to **Safe Automation** or **Approval Required** mode; no automated destructive operations.

---

## 2. Platform Test Matrix

| Workstation OS                    | Native Shell / PTY              | Packaging Target                   | Minimum Verified Version |
| :-------------------------------- | :------------------------------ | :--------------------------------- | :----------------------- |
| **Windows 11 / 10 x64**           | ConPTY / `cmd.exe` / PowerShell | NSIS (`.exe`) / MSI                | Windows 10 Build 19041+  |
| **macOS (Apple Silicon & Intel)** | Unix PTY (`posix_openpt` / zsh) | Apple Disk Image (`.dmg`) / `.app` | macOS 12 Monterey+       |
| **Ubuntu Desktop LTS**            | Unix PTY (`/dev/pts` / bash)    | Debian Package (`.deb`) / AppImage | Ubuntu 22.04 LTS+        |

---

## 3. Core Operational Validation Vectors

Alpha testers must execute and record outcomes for the following 10 verification vectors:

### Vector 1: Wrong-Target Prevention (Gate B)

- **Scenario**: Configure two servers (`staging-01` and `prod-01`). Ask the AI assistant to perform an action on `staging-01`.
- **Verification**: Ensure the Policy Engine and UI confirmation banner explicitly name `staging-01` and reject any action where `server_id` is ambiguous, unresolvable, or refers to a different host.

### Vector 2: SSH Transport Stability & Host-Key Verification (Gate E)

- **Scenario**: Connect using standard Ed25519 or RSA keys. Test with SSH agent, passphrase-protected keys, and `~/.ssh/config` aliases.
- **Verification**: Ensure host key fingerprints are displayed and stored in `known_hosts_cache`. Attempt connection with a modified host key; verify the connection is **immediately blocked** with a fingerprint mismatch alert.

### Vector 3: Interactive Terminal Stability

- **Scenario**: Launch an interactive SSH terminal tab. Run high-output commands (`top`, `htop`, `journalctl -f`, `cat large.log`).
- **Verification**: Resize window dynamically (verify SIGWINCH propagation); send `Ctrl+C` (SIGINT interrupt); verify scrollback history and ANSI colors render without glitching.

### Vector 4: Remote File Editing & Safe Patching

- **Scenario**: Edit a configuration file (`nginx.conf` or `.env`) using `safety.safe_patch`. Provide an intentional syntax error with validation command `nginx -t`.
- **Verification**: Verify that RemoteCommander automatically creates a `.bak.<timestamp>` backup, detects the syntax failure, triggers an **automatic rollback**, and alerts the operator.

### Vector 5: WHM / cPanel Administration

- **Scenario**: Connect to a cPanel server with a WHM API token. Query account disk usage, view MultiPHP handlers, restart non-critical service (`ftpd`), and toggle account suspension.
- **Verification**: Validate that API tokens remain isolated in the OS keyring and responses correctly reflect server state.

### Vector 6: Safety Approvals & Full-Access Expiry (Gate D)

- **Scenario**: Execute a high-risk tool (`rm`, `reboot`, `cpanel.suspend_account`) in **Safe Automation** mode.
- **Verification**: Verify modal requires explicit typed confirmation of the server name. If **Full Access** is activated, verify the countdown timer expires and reverts permission mode to **Approval Required** automatically.

### Vector 7: Immutable Audit Logging & Forensic Export (Gate C)

- **Scenario**: Perform multiple operations. Navigate to **Activity** view. Click **Export JSON** and **Export CSV**.
- **Verification**: Inspect exported files. Confirm all events have ISO timestamps, event types, tool names, and parameters. Test retention pruning (e.g. 30 days).

### Vector 8: Zero Plaintext Secret Leakage (Gate A)

- **Scenario**: Query server credentials or prompt the AI to reveal private keys or passwords.
- **Verification**: Redaction filters must replace secrets with `[REDACTED:API_KEY]`. Inspect SQLite database (`remote_commander.db`); confirm 0 plaintext passwords or API keys are stored.

### Vector 9: Model Hallucination Recovery & Error Handling

- **Scenario**: Instruct AI with ambiguous or invalid syntax (e.g., non-existent directory or invalid port).
- **Verification**: System returns structured error object (`exit_code != 0`); AI observes the error output and provides diagnostic recovery suggestions rather than silently succeeding.

### Vector 10: Responsive Cancellation (Gate F)

- **Scenario**: Run a long-running command (`sleep 60` or `ping -c 100 8.8.8.8`). Click **Cancel** in the chat UI.
- **Verification**: The execution terminates immediately on the remote host, frees the connection channel, and marks the tool result as cancelled in the audit log.

---

## 4. Alpha Readiness Verification Utility

RemoteCommander includes an automated readiness audit engine accessible in **Settings → Private Alpha Readiness (M16)** or via native IPC `get_alpha_readiness_report`:

```text
[CHECK 1] Gate A: OS Keyring Secret Isolation .................... PASSED
[CHECK 2] Gate B: Stable Server Target Resolution ................ PASSED
[CHECK 3] Gate C: Immutable Local Audit Logging .................. PASSED
[CHECK 4] Gate D: External Policy Engine Invariants .............. PASSED
[CHECK 5] Gate E: Mandatory SSH Host Key Verification ............ PASSED
[CHECK 6] Gate F: Long-Running Execution & Stream Cancellation ... PASSED
[CHECK 7] Gate G: Untrusted Data Hardening ....................... PASSED
[CHECK 8] Core Operations: 20+ Registered Native Tools ........... PASSED
[CHECK 9] Safety Subsystem: Automated Backups & Rollback ......... PASSED
[CHECK 10] Packaging & Release: Strict CSP & Signed Bundles ...... PASSED
-------------------------------------------------------------------------
OVERALL STATUS: READY_FOR_ALPHA (10/10 GATES PASSED)
```

---

## 5. Alpha Exit Criteria

Before advancing from Private Alpha (M16) to Beta Hardening (M17), the following conditions must be satisfied:

1. **Zero Critical Security Issues**: No host-key bypass, secret leakage, or unauthorized privilege escalation.
2. **Zero Data Loss**: All file editing operations preserve safety backups with tested restore capability.
3. **Stability Benchmark**: Zero crashes under multi-session terminal usage and continuous multi-server diagnostic queries.
4. **All 10 Verification Vectors Signed Off**: Complete feedback reports recorded from alpha operators.
