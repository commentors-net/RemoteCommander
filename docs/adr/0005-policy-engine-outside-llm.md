# ADR 0005: Policy Engine and Approval Boundary Resides Outside the LLM

- **Status**: Accepted
- **Date**: 2026-09-19
- **Author**: RemoteCommander Architecture Team
- **Context/Deciders**: Master Specification §0.4, §0.5, §0.11, §0.13 Gate D, §6, §10, §11

## Context

AI models are non-deterministic and inherently vulnerable to prompt injection, jailbreaking, and hallucination. Untrusted data returned from remote servers (log files, git commits, configuration files, error messages, web responses) can contain adversarial instructions designed to deceive the LLM into executing destructive commands (e.g. `rm -rf /` or disabling firewalls).

If permissions or approval checks are evaluated within the LLM prompt context or depend on the model's self-restraint, the system can be compromised.

## Decision

The **Policy Engine and Approval Boundary resides strictly in the native local application layer (Rust)**, completely outside of the LLM:

1. **Tool Invocation as a Request Only**: The LLM can only emit a structured _request_ for tool execution; it has zero direct access to operating system APIs or SSH connections.
2. **Deterministic Multi-Stage Validation Pipeline**:
   ```text
   LLM Tool Request
         │
         ▼
   Schema Validation (strict types, valid arguments)
         │
         ▼
   Target Scope & Environment Resolution (server_id, production vs dev)
         │
         ▼
   Policy Engine Evaluation (Risk Level: READ_ONLY, LOW, MEDIUM, HIGH, CRITICAL)
         │
         ▼
   Approval State & Policy Check (Approval Required, Safe Automation, Full Access)
         │
         ▼
   User Confirmation (if required by risk/policy; typed acknowledgement for CRITICAL)
         │
         ▼
   Execution & Immutably Recorded Audit Event
   ```
3. **Defense-in-Depth Command Heuristics**: Heuristic regex scanning flags destructive or suspicious command patterns (e.g., formatting disks, deleting system root, raw writes), but regex alone is not a security perimeter. Structured semantic tools (`server.service_restart`, `cpanel.account_info`) are preferred over raw shell invocations.
4. **Untrusted Data Isolation**: All tool outputs returning to the LLM are wrapped in untrusted data delimiters and never grant permission escalation.
5. **Full Access Invariant**: Even in Full Access mode, audit logging is never disabled, and critical boundaries remain enforced.

## Consequences

### Positive

- Strict security invariant Gate D: The model never authorizes its own actions.
- Immune to prompt injection bypassing approval gates.
- Clear audit trail of every requested vs approved action.

### Negative / Trade-offs

- Slight operational friction when explicit approvals are required for high-risk actions.
- Policy engine rules must be rigorously maintained and versioned.
