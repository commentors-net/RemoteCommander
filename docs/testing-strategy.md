# Testing Strategy — RemoteCommander

## 1. Objectives

Provide deterministic verification across the entire multi-tier architecture:

- TypeScript domain packages (`shared-types`, `tool-schema`, `ai-core`)
- React frontend components and state stores
- Rust native backend (Tauri commands, SQLite migrations, keyring abstraction, policy engine, SSH transport)

## 2. Test Tiers

### Tier 1: Unit Testing

- **TypeScript**: Vitest for fast, isolated testing of schemas, validation logic, risk classifiers, and AI message normalization.
- **Rust**: `cargo test` for testing policy rules, schema parsing, SQL migrations, heuristic command inspection, and error handling.

### Tier 2: Security & Isolation Tests

- **Secret Absence**: Verify that serialized audit records, SQLite dumps, and mock AI request payloads contain zero plaintext secrets or private keys.
- **Policy Enforcement**: Automated fuzzing of the policy engine with malicious prompt-injected payloads to confirm execution is blocked without user approval.
- **Heuristic Command Scanner**: Unit tests asserting that destructive command patterns (`rm -rf`, `mkfs`, `dd if=`, `DROP DATABASE`) are classified as `CRITICAL`.

### Tier 3: Integration Testing

- **SQLite Migrations**: In-memory SQLite test suites ensuring migrations run forward and schema constraints hold.
- **Mock SSH Transport**: In-memory SSH mock simulating connection lifecycles, exit codes, PTY byte streaming, and cancellation tokens.
- **Mock AI Provider**: Simulated streaming chat endpoint to test multi-turn tool loops, tool response handling, and error recovery.

### Tier 4: End-to-End Desktop Verification

- Tauri desktop integration tests validating IPC commands, UI tab transitions, and local terminal PTY spawning.

## 3. Continuous Integration Gates

CI must pass on all PRs and master branch commits:

- Formatting: `prettier --check`, `cargo fmt --check`
- Linting: `eslint`, `cargo clippy -- -D warnings`
- Types: `tsc --noEmit`
- Tests: `npm test`, `cargo test`
- Security: `npm run security:scan`, `npm run supply-chain:verify`

## 4. Operational Verification Vectors

Beyond automated unit and integration tests, RemoteCommander verifies 10 core operational vectors across authentic Linux hosting and server fleets:

1. **Wrong-Target Prevention (Gate B)**: Strict rejection of any tool call where `server_id` is ambiguous, unresolvable, or refers to a different host.
2. **SSH Transport Stability & Host-Key Verification (Gate E)**: Strict host key checking by default; visual fingerprint confirmation for unknown keys; instant connection termination on host key mismatches.
3. **Interactive Terminal Stability (PTY)**: Robust handling of high-output commands (`top`, `htop`, `journalctl -f`), dynamic terminal window resizing (`SIGWINCH`), interrupt handling (`Ctrl+C` / `SIGINT`), and xterm.js scrollback buffer rendering.
4. **Remote File Editing & Safe Patching**: Automatic `.bak.<timestamp>` creation prior to file writes; syntax pre-validation; automatic rollback on validation failure.
5. **WHM / cPanel Administration**: Native token isolation in OS Keyring; safe execution of UAPI and WHM API v1 calls (account listing, quota inspection, service restart, suspension).
6. **Safety Approvals & Full-Access Expiry (Gate D)**: Enforced approval gates for `MEDIUM`, `HIGH`, and `CRITICAL` risk tiers; mandatory typed server confirmation for destructive commands; auto-expiration timer for Full Access mode.
7. **Immutable Audit Logging & Forensic Export (Gate C)**: Synchronous append-only SQLite logging of all tool invocations, parameters, user approvals, and outputs; JSON and CSV export verification.
8. **Zero Plaintext Secret Leakage (Gate A)**: Hardware keyring isolation; regex secret redaction in all logs, UI state, and AI prompt context; zero plaintext credentials in SQLite storage.
9. **Model Hallucination Recovery & Error Handling**: Non-zero exit code capture and error reporting back to LLM; model diagnostic recovery rather than silent failure.
10. **Responsive Cancellation (Gate F)**: Responsive cooperative cancellation of long-running commands, streaming outputs, and SFTP transfers via `CancellationToken`.

## 5. Automated Readiness Verification Utility

RemoteCommander includes an automated readiness audit engine accessible via native IPC `get_alpha_readiness_report` and the Settings view:

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
OVERALL STATUS: READY_FOR_PRODUCTION (10/10 GATES PASSED)
```
