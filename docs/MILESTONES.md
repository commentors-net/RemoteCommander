# Implementation Milestone Roadmap

> **Document Note**: Full detailed requirements for each milestone are located in Appendix A of [`docs/MASTER_SPEC.md`](file:///D:/Jobs/workspace/RemoteCommander/docs/MASTER_SPEC.md#L4210-L5840).

## Milestone Overview

| Milestone  | Name                                                | Status        | Outcome                                                                 |
| ---------- | --------------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| **M0**     | Repository & Architecture Foundation                | **Completed** | Project skeleton, CI, ADRs, coding standards, test harness              |
| **M1**     | Desktop Shell & Local Persistence                   | **Completed** | Tauri app, React UI, SQLite, settings repository                        |
| **M2**     | Secure Secret Storage                               | **Completed** | OS keyring integration and secret isolation                             |
| **M3**     | Tool Runtime & Policy Core                          | **Completed** | Tool registry, risk model, approvals, audit plumbing                    |
| **M4**     | **Local AI + Tool Loop**                            | **Completed** | AI provider abstraction, streaming, local tools, multi-turn loop        |
| **M5**     | **Server Inventory & SSH Transport**                | **Completed** | Server profiles, host verification (Gate E), OpenSSH config & transport |
| **M6**     | **Remote Command Execution**                        | **Completed** | Structured remote execution, streaming, cancellation                    |
| **M7**     | **Interactive Terminal**                            | **Completed** | xterm.js + PTY + shared/manual sessions                                 |
| **M8**     | Remote File Management                              | **Completed** | SFTP browsing, upload/download, safe editing with backups               |
| **M9**     | Production Safety Layer                             | **Completed** | Strong approvals, target protection, heuristics, rollback helpers       |
| **M10**    | Semantic Server Operations                          | **Completed** | Service, process, logs, system-health tools                             |
| **M11**    | WHM/cPanel Integration                              | **Completed** | WHM/UAPI-aware server management                                        |
| **M12**    | Multi-Server Operations                             | **Completed** | Safe parallel diagnostics and scoped execution                          |
| **M13**    | Multi-Provider AI                                   | **Completed** | Anthropic, Gemini, Ollama, OpenAI-compatible APIs                       |
| **M14**    | Privacy, Data Controls & Prompt-Injection Hardening | **Completed** | Model-context controls and untrusted-data boundaries                    |
| **M15**    | Packaging, Updates & Release Security               | **Completed** | Signed installers, updater, SBOM, release gates                         |
| **M16**    | Private Alpha                                       | **Completed** | Production-like testing and limited real-world use                      |
| **M17**    | Beta Hardening                                      | **Completed** | Reliability, UX, performance, compatibility                             |
| **M18**    | v1.0 Release                                        | **Completed** | Stable desktop operations product                                       |
| **Future** | Optional Extensions                                 | Future        | MCP adapter (F1), remote agent (F2), automation (F3), GUI control (F4)  |

## Cross-Milestone Security Gates

- **Gate A (Secrets)**: No plaintext secrets in SQLite, logs, model messages, source control, audit events, or frontend localStorage.
- **Gate B (Target Identity)**: Any remote state-changing action must have a resolved stable `server_id`.
- **Gate C (Auditing)**: All privileged tool calls must emit an audit event.
- **Gate D (Model Authority)**: The model never authorizes its own action.
- **Gate E (Host Verification)**: SSH host identity must be verified by default.
- **Gate F (Cancellation)**: Long-running operations must expose cancellation.
- **Gate G (Untrusted Data)**: Remote content cannot elevate permission or bypass approval.
