# ADR 0003: Native Operating System Keyring for Secret Storage

- **Status**: Accepted
- **Date**: 2026-09-19
- **Author**: RemoteCommander Architecture Team
- **Context/Deciders**: Master Specification §0.10, §0.13 Gate A, §3

## Context

The application handles highly privileged secrets:

- AI provider API keys (OpenAI, Anthropic, Gemini, etc.)
- SSH passwords and private key passphrases
- WHM API access tokens and integration secrets

Storing plaintext credentials or encrypted blobs with hardcoded/weak keys in configuration files, SQLite, or frontend localStorage introduces unacceptable exposure risks to local malware, accidental repository commits, or model exfiltration via prompt injection.

## Decision

We mandate the use of the **native operating system credential store** as the primary storage mechanism for all sensitive credentials:

- **Windows**: Windows Credential Manager
- **macOS**: Apple Keychain
- **Linux**: Secret Service API / GNOME Keyring / compatible freedesktop Secret Service

In Rust, this is accessed via native keyring bindings (`keyring` crate).

- The application stores and tracks an opaque `credential_ref` (such as `vault:secret:<uuid>`) in SQLite.
- When an operation requires authentication (e.g. initiating an SSH handshake or sending an AI request), the Rust backend retrieves the secret directly into memory at invocation time.
- Raw secrets are never exposed to the React frontend UI or serialized into AI prompts, audit logs, or telemetry.

## Consequences

### Positive

- Leverage battle-tested OS-level encryption and access controls.
- Eliminates custom encryption key management pitfalls.
- Enforces strict security boundary Gate A: No plaintext secrets in SQLite, logs, or frontend storage.

### Negative / Trade-offs

- Headless Linux environments without a running D-Bus/Secret Service daemon may require fallback handling or explicit user configuration.
- Native library dependencies on Linux (`libsecret-1-dev`) must be documented for builds.
