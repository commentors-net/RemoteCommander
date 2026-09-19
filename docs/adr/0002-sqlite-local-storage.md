# ADR 0002: SQLite for Local Structured Storage

- **Status**: Accepted
- **Date**: 2026-09-19
- **Author**: RemoteCommander Architecture Team
- **Context/Deciders**: Master Specification §0.10, §3, §21

## Context

The application needs local persistence for:

- Server inventory profiles and connection metadata
- Conversation threads and chat message history
- Tool execution logs and audit history
- User settings and preferences
- Approval history and policy rules

We must ensure that:

1. Operations can function completely offline without reliance on a remote database.
2. Migrations and schema evolution are deterministic and manageable.
3. Plaintext secrets are strictly forbidden from being stored in the database.

## Decision

We use an embedded **SQLite** database via Rust (`rusqlite` or `sqlx` with SQLite driver).

Key architectural constraints:

1. **Zero Secret Storage**: API keys, SSH private keys, passphrases, and WHM API tokens must never be written to SQLite tables. SQLite will only store stable opaque credential references (`credential_ref`, e.g., UUID or URN) that resolve against the OS credential keyring.
2. **Deterministic Migrations**: All schema changes must use versioned, sequential migration scripts.
3. **Audit Trail Immutability**: Tool call audit tables (`audit_events`, `tool_calls`) must record complete structured metadata (caller, tool name, resolved target `server_id`, arguments, risk level, approval status, exit code, duration, timestamps) without plaintext credentials.

## Consequences

### Positive

- Zero external database services needed; single-file storage in user application data directory.
- Fast ACID compliance for local audit logs and chat history.
- Easy to back up or export application state.

### Negative / Trade-offs

- Concurrency must be managed cleanly using WAL mode to prevent lock contention between background audit writes and UI queries.
