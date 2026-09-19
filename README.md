# RemoteCommander

> **Secure Desktop AI Operations Assistant**  
> Single-user, local-first desktop application for AI-assisted management of local workstations and remote Linux/WHM/cPanel servers, including root-level operations.

---

## 1. Core Architectural Principles

1. **Local-Only Control Plane (Zero Mandatory Relay)**:
   The desktop application communicates directly with AI providers over HTTPS and remote servers over SSH/SFTP/HTTPS. There are no vendor relays or cloud execution proxies.
2. **Authoritative Desktop Baseline**:
   Built with **Tauri + React + TypeScript + Rust (Tokio) + SQLite + xterm.js + Native OS Keyring**.
3. **Native Credential Storage**:
   Raw secrets are stored strictly in the OS credential store (Windows Credential Manager, macOS Keychain, Linux Secret Service). SQLite and frontend storage only retain opaque credential references.
4. **Policy Engine Outside the LLM**:
   The LLM proposes actions via structured JSON tool requests; authority and execution decisions reside entirely within the native Rust policy engine.
5. **Risk-Based Approvals**:
   Operations are classified across 5 risk tiers (`READ_ONLY`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), enforcing typed acknowledgements for destructive commands.
6. **Prompt-Injection Resilience**:
   Output from remote servers, logs, and files is demarcated as untrusted external data and cannot elevate application execution privileges.

---

## 2. Monorepo Structure

```text
RemoteCommander/
├── apps/
│   └── desktop/                  # Tauri v2 + React desktop application
│       ├── src/                  # React UI components, navigation, stores
│       └── src-tauri/            # Rust native core: IPC, policy, SSH transport
├── packages/
│   ├── shared-types/             # Core domain models (servers, risk, policy, audit)
│   ├── tool-schema/              # Tool schemas, catalog, heuristic scanner
│   └── ai-core/                  # AI provider abstraction, message models, loop
├── docs/
│   ├── MASTER_SPEC.md            # Architecture & authoritative requirements
│   ├── MILESTONES.md             # Implementation roadmap & delivery gates
│   ├── architecture.md           # System topology & tool execution pipeline
│   ├── threat-model.md           # Assets, boundaries, and threat mitigations
│   ├── security.md               # Non-negotiable security invariants
│   ├── testing-strategy.md       # Multi-tiered verification strategy
│   └── adr/                      # Architecture Decision Records
│       ├── 0001-tauri-react-rust.md
│       ├── 0002-sqlite-local-storage.md
│       ├── 0003-native-os-keyring.md
│       ├── 0004-direct-ssh-no-mandatory-relay.md
│       ├── 0005-policy-engine-outside-llm.md
│       └── 0006-mcp-not-core.md
├── scripts/
│   ├── scan-secrets.mjs          # Secret scanner (Gate A verification)
│   └── security-check.mjs        # Security invariants validation suite
├── .github/workflows/
│   └── ci.yml                    # Automated CI pipeline
├── Cargo.toml                    # Rust workspace definition
└── package.json                  # Node workspace definition
```

---

## 3. Development Prerequisites

- **Node.js**: v20+ (v22 recommended)
- **Rust**: 1.77+ (edition 2021)
- **Operating System**: Windows 10/11, macOS 12+, or modern Linux desktop

---

## 4. Quick Start & Common Commands

### Install Dependencies

```bash
npm install
```

### Run Tests

```bash
# Run all TypeScript package tests
npm test

# Run Rust unit and integration tests
npm run rust:test
```

### Linting & Formatting

```bash
# TypeScript & JavaScript linting
npm run lint

# Rust formatting and clippy
npm run rust:fmt
npm run rust:clippy
```

### Security & Invariant Scans

```bash
# Run repository secret scanner (Gate A)
npm run security:scan

# Run full M0 security suite
node scripts/security-check.mjs
```

---

## 5. Milestone Roadmap

Refer to [`docs/MILESTONES.md`](file:///D:/Jobs/workspace/RemoteCommander/docs/MILESTONES.md) and [`MASTER_SPEC_with_MILESTONES_Secure_Desktop_AI_Operations_Assistant.md`](file:///D:/Jobs/workspace/RemoteCommander/MASTER_SPEC_with_MILESTONES_Secure_Desktop_AI_Operations_Assistant.md) for complete details on milestones M0 through M18.
