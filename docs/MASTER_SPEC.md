# Authoritative Master Specification

> **Document Note**: The complete authoritative text is maintained in [`MASTER_SPEC_with_MILESTONES_Secure_Desktop_AI_Operations_Assistant.md`](file:///D:/Jobs/workspace/RemoteCommander/MASTER_SPEC_with_MILESTONES_Secure_Desktop_AI_Operations_Assistant.md) at the repository root.

## Core Architectural Invariants

1. **Local-Only Control Plane & Zero Mandatory Relay**:
   - Desktop application communicates directly with AI providers via HTTPS and user servers via SSH/SFTP/HTTPS.
   - No third-party relay or hosted middleman.
2. **Tauri Baseline**:
   - Tauri + React + TypeScript + Rust + Tokio + SQLite + xterm.js + native OS credential store.
3. **Transport Abstraction**:
   - `SSHTransport` abstraction prioritizing OpenSSH compatibility (`~/.ssh/config`, `known_hosts`, SSH Agent).
4. **Policy Engine Outside LLM**:
   - The policy engine is authoritative; regex is defense-in-depth only.
   - The LLM can never authorize its own execution.
5. **Risk-Based Approvals**:
   - `READ_ONLY`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` risk tiers with typed confirmation for critical actions.
6. **Structured Semantic Tools First**:
   - High-level tools (`server.*`, `cpanel.*`) preferred over arbitrary shell commands.
7. **Intentional Root Capability**:
   - Root execution is supported with strict audit logging, target isolation, and credential protection.
8. **Stable Target Identity**:
   - Every remote operation is anchored to a resolved `server_id`.
9. **Native Credential Storage**:
   - Zero plaintext secrets in SQLite, logs, frontend, or source code.
10. **Prompt-Injection Resilience**:
    - Remote content is treated as untrusted data and cannot escalate privileges.
