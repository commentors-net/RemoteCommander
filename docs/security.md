# Security Policy & Invariants — RemoteCommander

## 1. Non-Negotiable Invariants

As mandated by §0.13 of the Master Specification:

1. **Credentials Isolation**: The model never receives private SSH keys, passwords, or credential secrets in its prompt or message history.
2. **Frontend Protection**: The frontend JavaScript runtime does not own, store, or manage privileged secrets.
3. **SSH Host-Key Verification**: Host-key verification is mandatory and enabled by default; it is never silently disabled.
4. **TLS Verification**: Strict TLS certificate validation is enforced on all HTTPS interactions (WHM/cPanel APIs, AI providers).
5. **Untrusted Data Boundary**: Tool output is untrusted data and cannot alter policy states or grant authorization.
6. **Closed Tool Surface**: Undefined tools cannot be invoked.
7. **External Policy Authority**: Policy evaluation occurs in native code outside the LLM.
8. **Immutable Auditing**: Full Access mode never disables audit logging.
9. **Visible Target Identity**: The active target machine (`server_id`, hostname, environment) is always visible during remote execution.
10. **Impact Transparency**: Critical actions explicitly identify the target, payload, and anticipated blast radius.
11. **User Cancellation**: Active tool executions support immediate cancellation tokens.
12. **No Blind Destructive Retries**: Destructive actions are never retried automatically on failure.
13. **Safe Change Patterns**: Configuration edits follow backup → change → validate → verify → rollback patterns.
14. **Zero Mandatory Relay**: No third-party proxy or cloud execution service is required for core operation.
15. **Explicit Telemetry**: External telemetry is strictly opt-in and disabled by default.

## 2. Secrets Management

- **Storage**: Windows Credential Manager (`wincred`), macOS Keychain, Linux Secret Service (`secret-service`).
- **Database Rules**: SQLite tables (`servers`, `settings`, `audit_events`, `tool_calls`) store only opaque reference keys (`credential_ref`).
- **Sanitization**: All log output and tool call serialization pass through secret redaction filters before storage or display.

## 3. Approval & Risk Levels

| Level       | Definition                                                   | Default Behavior                                                |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `READ_ONLY` | Queries, metrics, non-modifying diagnostics                  | Permitted automatically when policy allows                      |
| `LOW`       | Benign operations (mkdir, upload non-system file)            | Auto in Safe Automation; requires approval in Approval Required |
| `MEDIUM`    | Single service restarts, website config edits                | Requires user confirmation on production by default             |
| `HIGH`      | Package upgrades, firewall changes, bulk operations          | Always requires explicit approval                               |
| `CRITICAL`  | Data deletion, formatting, account deletion, raw disk writes | Requires typed confirmation with target/impact acknowledgement  |

## 4. Vulnerability Reporting & Dependency Audits

- Automated `npm audit` and `cargo audit` in CI pipelines.
- Secret scanning on commit and in CI to prevent accidental leakages.
