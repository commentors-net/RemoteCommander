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
- Security: `npm audit`, `cargo audit`, secret scanning
