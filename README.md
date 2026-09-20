# RemoteCommander

> **Secure Desktop AI Operations Assistant**  
> Single-user, local-first desktop application for AI-assisted management of local workstations and remote Linux/WHM/cPanel server fleets, including root-level operations.

[![Version](https://img.shields.io/badge/version-1.0.0--GA-green.svg)](docs/RELEASE_NOTES_v1.0.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Milestones](https://img.shields.io/badge/Milestones-M0--M18%20Completed-brightgreen.svg)](docs/MILESTONES.md)
[![Security Gates](https://img.shields.io/badge/Security%20Gates-A--G%20Compliant-success.svg)](docs/RELEASE_NOTES_v1.0.md#3-cross-milestone-security-gates-sign-off)
[![Tests](https://img.shields.io/badge/Tests-144%20TS%20%7C%2089%20Rust%20Passing-brightgreen.svg)](docs/RELEASE_NOTES_v1.0.md#5-security--verification-summary)

---

## 1. Executive Summary

RemoteCommander v1.0.0 is a hardened, production-grade desktop application engineered specifically for system administrators, SREs, and hosting providers. It bridges modern AI model reasoning (OpenAI, Anthropic Claude, Google Gemini, and local offline Ollama) with authoritative, local-first Linux fleet operations.

### The Golden Security Rule:
> **The desktop application owns authority. The AI model proposes and reasons; the local native Rust runtime validates, authorizes, executes, records, and recovers.**

---

## 2. Core Architectural Principles

1. **Local-Only Control Plane (Zero Mandatory Cloud Relay)**:
   All SSH and SFTP connections are initiated directly from your workstation to your remote servers. Zero server credentials, SSH keys, or server outputs ever transit intermediary cloud proxies.
2. **Hardware-Backed Secret Isolation (Security Gate A)**:
   API keys, SSH passwords, and WHM tokens are stored in the host operating system's native secure keyring (Windows Credential Manager, macOS Keychain, Linux Secret Service). SQLite and frontend storage only retain opaque credential references.
3. **Out-of-Context Policy Engine (Security Gate D)**:
   The LLM proposes actions via structured JSON tool requests; authority and risk tier evaluation execute entirely within the native Rust policy core, completely outside model context.
4. **Deterministic Target Identity (Security Gate B)**:
   Remote operations require resolved, stable `server_id` attributes. The assistant is cryptographically prevented from executing commands on unconfirmed or ambiguous servers.
5. **Immutable Audit Trail (Security Gate C)**:
   All privileged tool calls, parameters, human approvals, and execution outputs are persisted to an append-only local SQLite database with RFC 3339 timestamps.
6. **Strict Host Key Verification (Security Gate E)**:
   SSH host identities are verified by default before credential exchange, eliminating Man-In-The-Middle (MITM) risks.
7. **Cooperative Cancellation (Security Gate F)**:
   All streaming commands, file transfers, and multi-server diagnostic sweeps expose cancellation controls.
8. **Prompt-Injection Resilience (Security Gate G)**:
   Remote stdout/stderr, syslog entries, and file contents are encapsulated in rigid untrusted external data boundaries (`<<< UNTRUSTED EXTERNAL DATA >>>`), neutralizing prompt injection attacks.

---

## 3. Comprehensive Documentation

- **[User Manual (Getting Started & Operations Runbook)](docs/USER_MANUAL.md)**: Detailed guide on configuring OpenAI / Anthropic / Gemini / Ollama API keys, adding remote servers, understanding risk tiers, managing approvals, running terminal commands, editing files, and managing cPanel/WHM.
- **[v1.0 Production Release Notes](docs/RELEASE_NOTES_v1.0.md)**: Release highlights, architectural summary, distro compatibility matrix, and verification report.
- **[Milestone Roadmap](docs/MILESTONES.md)**: Status of all milestones M0 through M18.
- **[System Architecture](docs/architecture.md)**: Deep dive into the Tauri + React + Rust IPC pipeline and policy runtime.
- **[Threat Model & Security Invariants](docs/threat-model.md)**: Security boundaries, asset classification, and attack mitigations.

---

## 4. Monorepo Structure

```text
RemoteCommander/
├── apps/
│   └── desktop/                  # Tauri v2 + React 18 desktop application
│       ├── src/                  # React UI components, navigation, views, bridge
│       └── src-tauri/            # Rust native core: IPC, policy, SSH transport, SQLite
├── packages/
│   ├── shared-types/             # Core domain models (servers, risk, policy, audit)
│   ├── tool-schema/              # Tool schemas, catalog, heuristic scanner
│   └── ai-core/                  # Multi-provider AI core (OpenAI, Claude, Gemini, Ollama)
├── docs/
│   ├── USER_MANUAL.md            # Comprehensive user operator guide
│   ├── RELEASE_NOTES_v1.0.md     # Production release notes for v1.0.0 GA
│   ├── MILESTONES.md             # Implementation roadmap & delivery gates
│   ├── ALPHA_TEST_PLAN.md        # Private Alpha testing protocol
│   ├── architecture.md           # System topology & tool execution pipeline
│   ├── threat-model.md           # Assets, boundaries, and threat mitigations
│   ├── security.md               # Non-negotiable security invariants
│   ├── testing-strategy.md       # Multi-tiered verification strategy
│   └── adr/                      # Architecture Decision Records (0001–0006)
├── scripts/
│   ├── scan-secrets.mjs          # Secret scanner (Gate A verification)
│   ├── generate-sbom.mjs         # CycloneDX v1.5 SBOM generator
│   ├── verify-supply-chain.mjs   # Supply chain integrity verification
│   └── security-check.mjs        # Security invariants validation suite
├── Cargo.toml                    # Rust workspace definition
└── package.json                  # Node workspace definition
```

---

## 5. Quick Start for Operators

### Step 1: Install & Launch
Run in development mode or build production binaries:

```bash
# Install dependencies
npm install

# Build all TypeScript packages and bundle desktop UI
npm run build

# Launch the desktop application
npm run dev
```

### Step 2: Configure AI Provider & API Keys
1. Open **Settings** (cog icon or `Ctrl+,`).
2. Select your AI Provider:
   - **OpenAI:** Enter your API key (`sk-...`) and select model (e.g., `gpt-4o`).
   - **Anthropic:** Enter your Claude API key (`sk-ant-...`) and select model (e.g., `claude-3-5-sonnet`).
   - **Google Gemini:** Enter your Gemini API key and select model (`gemini-2.0-flash`).
   - **Ollama (Local / Offline):** Connect to `http://127.0.0.1:11434` for completely private, zero-cloud operations with `deepseek-r1`, `qwen2.5-coder`, or `llama3.3`.
3. *All keys are instantly encrypted and saved to your OS Keyring.*

### Step 3: Add Servers & Start Chatting
1. Go to **Servers** tab -> **Add Server**.
2. Enter IP/hostname, SSH port (default `22`), and username.
3. Switch to **Chat** tab and ask the assistant:
   - *"Check disk space and system uptime on production01."*
   - *"Inspect the last 50 lines of nginx error log."*
   - *"List active cPanel accounts exceeding 80% disk quota."*
4. When the AI proposes a command or configuration change, review the **Approval Card** with risk tier and expected impact, then click **Approve** or **Reject**.

*For complete walkthroughs, read the [RemoteCommander User Manual](docs/USER_MANUAL.md).*

---

## 6. Development & Verification Commands

```bash
# Build all workspaces
npm run build

# Run all TypeScript test suites (144 tests)
npm test

# Run all Rust native tests (89 tests)
npm run rust:test

# Lint and verify code formatting
npm run lint

# Rust clippy and rustfmt
npm run rust:clippy
npm run rust:fmt

# Security scans & supply chain audit
npm run security:scan
npm run supply-chain:verify
npm run sbom:generate
```

---

## 7. Packaging & Distribution

To create release installer bundles (Windows NSIS `.exe` / `.msi`, macOS `.dmg`, Linux `.AppImage`):

```bash
npx tauri build
```
Compiled bundles and SHA-256 manifests are generated in `apps/desktop/src-tauri/target/release/bundle/`.

---

## 8. License

RemoteCommander is released under the [MIT License](LICENSE).  
Copyright © 2026 RemoteCommander Team.
