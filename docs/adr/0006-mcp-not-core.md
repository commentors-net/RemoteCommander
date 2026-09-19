# ADR 0006: Model Context Protocol (MCP) As Optional Adapter, Not Core Dependency

- **Status**: Accepted
- **Date**: 2026-09-19
- **Author**: RemoteCommander Architecture Team
- **Context/Deciders**: Master Specification §0.1, §0.14, §1, §22 (Future F1)

## Context

The Model Context Protocol (MCP) has emerged as an open standard for connecting AI clients with tool servers. However, making MCP the foundational architectural transport for core server administration introduces several challenges:

1. Many MCP bridges assume cloud-hosted transports or separate client-server daemons, risking violation of our zero-mandatory-relay principle.
2. Direct native SSH/SFTP streaming, interactive PTYs, and OS credential integrations require fine-grained desktop lifecycle controls that generic MCP wrappers do not readily provide.
3. Tight coupling to an evolving protocol could introduce external churn into core security and approval boundaries.

## Decision

We establish that **core internal tool orchestration uses a native, strongly typed TypeScript/Rust contract**:

1. All core operations (local tools, SSH transport, terminal PTY, cPanel/WHM APIs, and policy enforcement) are implemented directly in the local Tauri/Rust application core.
2. MCP is classified as an **optional, local-only compatibility adapter** for future extension (Milestone F1).
3. If MCP servers or clients are integrated in future milestones, they will run strictly locally over stdio or localhost loopback, with identical policy engine inspection and audit gates. Under no circumstances will a hosted or third-party MCP relay be introduced.

## Consequences

### Positive

- Autonomous, lightweight, and dependency-free core runtime.
- Guaranteed adherence to the local-first, zero-relay security architecture.
- Full control over PTY multiplexing, cancellation tokens, and real-time output streaming.

### Negative / Trade-offs

- Integration with third-party MCP tool ecosystems is deferred to the F1 extension milestone.
