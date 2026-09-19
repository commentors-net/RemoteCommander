# Architecture Overview — RemoteCommander

## 1. System Topology

RemoteCommander is a single-user, local-first desktop application. There are no mandatory intermediate cloud relays.

```text
┌─────────────────────────────────────────────────────────────┐
│                    Desktop Application                      │
│                                                             │
│   React / TypeScript UI Layer (WebView2 / WebKit)          │
│   ├── Chat View                                             │
│   ├── Terminal (xterm.js)                                   │
│   ├── File Browser & Patch Editor                          │
│   ├── Server Inventory & Metrics                            │
│   ├── Audit Log & Activity Inspector                        │
│   └── Settings & Security Preferences                       │
│                                                             │
│   Tauri IPC Bridge (Strict Schema Validation)               │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     Rust Core (Tokio)                       │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Policy Engine & Security Boundary                     │  │
│  │ ├── Schema validation & parameter bounds              │  │
│  │ ├── Target identity verification (server_id)          │  │
│  │ ├── Risk assessment (READ_ONLY..CRITICAL)             │  │
│  │ ├── Approval gate & typed acknowledgement             │  │
│  │ └── Command heuristic scanner (defense-in-depth)      │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│  ┌───────────────────────────┴───────────────────────────┐  │
│  │ Local Execution Engine                                │  │
│  │ ├── SQLite Storage (Non-secret state, audit, chat)    │  │
│  │ ├── OS Keyring Adapter (WinCred, Keychain, SecretSvc) │  │
│  │ ├── SSHTransport (OpenSSH / Embedded Rust SSH)       │  │
│  │ ├── Local System & PTY Manager                        │  │
│  │ └── cPanel / WHM API Client (TLS enforced)            │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
       Direct HTTPS                    Direct SSH / SFTP / UAPI
               │                               │
               ▼                               ▼
       AI Provider API               User's Remote Servers
    (OpenAI, Anthropic,             (Linux, cPanel/WHM VPS,
     Gemini, Ollama)                 Dedicated Bare Metal)
```

## 2. Monorepo Structure

```text
RemoteCommander/
├── apps/
│   └── desktop/                 # Tauri v2 + React desktop application
│       ├── src/                 # React UI, components, stores, hooks
│       ├── src-tauri/           # Rust core: IPC commands, transport, policy, DB
│       └── package.json
├── packages/
│   ├── shared-types/            # Common domain types (servers, audit, risk, policy)
│   ├── tool-schema/             # Tool definitions, JSON schemas, risk annotations
│   └── ai-core/                 # AI provider interfaces, message normalization, loop
├── docs/                        # Specifications, ADRs, threat models
├── scripts/                     # Tooling scripts (audit, secret scan, build)
└── package.json                 # Workspace root config
```

## 3. Tool Execution Pipeline

Every tool execution request originating from the LLM traverses the following immutable pipeline:

```text
1. LLM Tool Invocation Request (Name + Arguments JSON)
   ↓
2. JSON Schema Validation (Verify structure, sanitize inputs)
   ↓
3. Target Scope Verification (Resolve server_id, check target environment)
   ↓
4. Policy Engine Evaluation (Calculate risk: READ_ONLY, LOW, MEDIUM, HIGH, CRITICAL)
   ↓
5. Approval Evaluation:
   - Approval Required: All state changes prompt user
   - Safe Automation: READ_ONLY and LOW run automatically; MEDIUM+ prompts
   - Full Access: Commands run automatically unless CRITICAL typed confirmation is configured
   ↓
6. Execution via Rust Subsystem:
   - Local tool execution OR
   - SSHTransport invocation (PTY / direct execution) OR
   - WHM/UAPI HTTPS client
   ↓
7. Immutable Audit Event Emission:
   - Written synchronously to SQLite audit table before returning
   ↓
8. Result Sanitization:
   - Credentials redacted if detected
   - Wrapped in untrusted boundary markers
   - Returned to LLM orchestrator loop
```

## 4. Concurrency & Asynchronous Model

- Rust backend utilizes `tokio` multi-threaded runtime.
- Long-running commands support explicit cancellation via cancellation tokens.
- Output streams incrementally via Tauri event emissions to xterm.js / Chat logs without blocking the UI thread.
