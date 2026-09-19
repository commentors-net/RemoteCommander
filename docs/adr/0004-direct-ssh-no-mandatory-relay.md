# ADR 0004: Direct SSH Architecture with Zero Mandatory Relay

- **Status**: Accepted
- **Date**: 2026-09-19
- **Author**: RemoteCommander Architecture Team
- **Context/Deciders**: Master Specification §0.1, §0.3, §2, §8

## Context

Many remote administration architectures rely on cloud relays, hosted proxy agents, or vendor-operated bridges to forward commands from a client to remote servers. Such architectures introduce:

- Third-party data exposure and privacy hazards.
- Potential single points of failure and vendor lock-in.
- Broad attack surfaces where compromised relays gain root shell access to target infrastructure.
- High operational costs and hosting requirements for single users.

## Decision

We commit to a **local-only control plane with zero mandatory relay**:

1. The desktop application establishes direct outbound connections (`SSH`, `SFTP`, `HTTPS/UAPI`) directly from the user's desktop to the user's servers.
2. AI-provider traffic (e.g., HTTPS to OpenAI/Anthropic/Gemini) is strictly decoupled from server-control traffic.
3. System OpenSSH integration is evaluated and supported first (leveraging `~/.ssh/config`, `known_hosts`, local SSH Agent, and ProxyJump).
4. Any future cloud relay or remote agent (F2) must remain strictly optional, opt-in, disabled by default, and never become a hard dependency.
5. SSH host-key verification is non-negotiable and enabled by default to prevent man-in-the-middle attacks.

## Consequences

### Positive

- Zero intermediate cloud trust or telemetry requirements; maximum privacy.
- Leverages existing battle-tested SSH configurations, bastion jump hosts, and VPN tunnels.
- Clean architectural alignment with single-user, local-first computing.

### Negative / Trade-offs

- The user's desktop must have network reachability (direct, VPN, or SSH ProxyJump) to the target servers.
- When the desktop application closes, active background server tasks managed solely by the client terminate unless detached via remote session managers (e.g. `tmux` / `screen` or systemd services).
