//! Policy Engine and Risk-Based Approval Boundary
//! Authoritative baseline defined in Master Specification §0.4, §0.5, §10, §11, §26, and ADR 0005.
//! Policy evaluation occurs STRICTLY outside the LLM in native Rust.

use crate::models::ServerRecord;
use crate::RiskLevel;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionMode {
    #[serde(rename = "APPROVAL_REQUIRED")]
    ApprovalRequired,
    #[serde(rename = "SAFE_AUTOMATION")]
    SafeAutomation,
    #[serde(rename = "FULL_ACCESS")]
    FullAccess,
}

impl std::str::FromStr for PermissionMode {
    type Err = std::convert::Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "SAFE_AUTOMATION" => PermissionMode::SafeAutomation,
            "FULL_ACCESS" => PermissionMode::FullAccess,
            _ => PermissionMode::ApprovalRequired,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PolicyDecisionType {
    #[serde(rename = "ALLOW")]
    Allow,
    #[serde(rename = "REQUIRE_APPROVAL")]
    RequireApproval,
    #[serde(rename = "REQUIRE_TYPED_CONFIRMATION")]
    RequireTypedConfirmation,
    #[serde(rename = "DENY")]
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub decision: PolicyDecisionType,
    pub reason: String,
    pub risk_level: String,
    pub requires_typed_confirmation: bool,
    pub typed_confirmation_prompt: Option<String>,
}

// Defense-in-depth destructive command scanner patterns
static REGEX_ROOT_DELETE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\brm\s+-[rfR]{1,3}\s+(?:/|/\*|~|\$HOME|\.\.)(?:\s|$)").unwrap()
});
static REGEX_FORMAT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(mkfs|wipefs|parted|fdisk|cfdisk|sfdisk)\b").unwrap());
static REGEX_RAW_WRITE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bdd\s+if=.*?of=/dev/(?:sd[a-z]|nvme\d+n\d+|vd[a-z])").unwrap()
});
static REGEX_DROP_DB: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bDROP\s+(?:DATABASE|SCHEMA)\b").unwrap());
static REGEX_FIREWALL_DISABLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(ufw\s+disable|iptables\s+-F|nft\s+flush\s+ruleset|systemctl\s+stop\s+firewalld)\b",
    )
    .unwrap()
});

/// Scan for destructive command patterns as defense-in-depth (Master Spec §10A)
pub fn scan_destructive_command_heuristics(command: &str) -> (bool, Option<&'static str>) {
    if REGEX_ROOT_DELETE.is_match(command) {
        return (true, Some("ROOT_RECURSIVE_DELETION"));
    }
    if REGEX_FORMAT.is_match(command) {
        return (true, Some("FILESYSTEM_FORMAT"));
    }
    if REGEX_RAW_WRITE.is_match(command) {
        return (true, Some("RAW_BLOCK_DEVICE_WRITE"));
    }
    if REGEX_DROP_DB.is_match(command) {
        return (true, Some("DATABASE_DROP"));
    }
    if REGEX_FIREWALL_DISABLE.is_match(command) {
        return (true, Some("FIREWALL_DISABLE"));
    }

    (false, None)
}

/// Identifies safe, read-only diagnostic commands for automated telemetry (Master Spec §9 M6)
pub fn is_read_only_diagnostic_command(command: &str) -> bool {
    let clean = command.trim();
    if clean.is_empty() {
        return false;
    }
    // Disallow output redirection or command substitution in read-only classification
    if clean.contains('>') || clean.contains('`') || clean.contains("$(") {
        return false;
    }

    let parts: Vec<&str> = clean
        .split(';')
        .flat_map(|s| s.split("&&"))
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    for p in parts {
        let first_word = p
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();

        let allowed = match first_word.as_str() {
            "uptime" | "df" | "free" | "uname" | "hostname" | "date" | "arch" | "w" | "who"
            | "id" | "whoami" | "vmstat" | "iostat" | "netstat" | "ss" => true,
            "ps" | "ls" => true,
            "cat" => {
                p.contains("/etc/")
                    || p.contains("/proc/")
                    || p.contains("/sys/")
                    || p.contains(".txt")
                    || p.contains(".log")
                    || p.contains(".conf")
            }
            "systemctl" => p.contains("status") || p.contains("is-active"),
            _ => false,
        };
        if !allowed {
            return false;
        }
    }
    true
}

/// Pure policy engine decision function
pub fn evaluate_policy(
    tool_category: &str,
    risk_level: &RiskLevel,
    target_server: Option<&ServerRecord>,
    permission_mode: PermissionMode,
    command_str: Option<&str>,
) -> PolicyDecision {
    // 1. Target resolution invariant for remote tools (Security Gate B)
    let is_remote_tool =
        tool_category == "ssh" || tool_category == "server" || tool_category == "cpanel";
    if is_remote_tool && target_server.is_none() {
        return PolicyDecision {
            decision: PolicyDecisionType::Deny,
            reason: "Target server could not be resolved for remote operation".into(),
            risk_level: risk_level.as_str().into(),
            requires_typed_confirmation: false,
            typed_confirmation_prompt: None,
        };
    }

    // 2. Destructive command heuristics inspection
    let (is_destructive_heuristic, heuristic_name) = if let Some(cmd) = command_str {
        scan_destructive_command_heuristics(cmd)
    } else {
        (false, None)
    };

    // 3. Critical operations or destructive heuristic matches ALWAYS require typed confirmation
    if *risk_level == RiskLevel::Critical || is_destructive_heuristic {
        let prompt = if let Some(srv) = target_server {
            format!(
                "CRITICAL ACTION: {}\nServer: {} ({})\nType '{}' to confirm execution.",
                heuristic_name.unwrap_or("CRITICAL_OPERATION"),
                srv.name,
                srv.environment,
                srv.name
            )
        } else {
            "CRITICAL LOCAL ACTION: Type 'CONFIRM' to execute.".to_string()
        };

        return PolicyDecision {
            decision: PolicyDecisionType::RequireTypedConfirmation,
            reason: format!(
                "Operation is classified as CRITICAL (Reason: {})",
                heuristic_name.unwrap_or("Critical Risk Level")
            ),
            risk_level: "CRITICAL".into(),
            requires_typed_confirmation: true,
            typed_confirmation_prompt: Some(prompt),
        };
    }

    // 4. Determine effective risk level: recognized read-only diagnostics evaluate as ReadOnly
    let is_read_only_diag = if tool_category == "ssh" {
        command_str
            .map(is_read_only_diagnostic_command)
            .unwrap_or(false)
    } else {
        false
    };

    let effective_risk = if is_read_only_diag {
        &RiskLevel::ReadOnly
    } else {
        risk_level
    };

    // 5. READ_ONLY operations auto-allowed when policy allows
    if *effective_risk == RiskLevel::ReadOnly {
        return PolicyDecision {
            decision: PolicyDecisionType::Allow,
            reason: if is_read_only_diag {
                "Read-only remote diagnostic command allowed automatically".into()
            } else {
                "Read-only operation allowed automatically".into()
            },
            risk_level: effective_risk.as_str().into(),
            requires_typed_confirmation: false,
            typed_confirmation_prompt: None,
        };
    }

    let is_production = target_server
        .map(|s| s.environment == "PRODUCTION")
        .unwrap_or(false);

    // 5. Full Access mode evaluation
    if permission_mode == PermissionMode::FullAccess {
        // High risk on production requires approval even in Full Access
        if *risk_level == RiskLevel::High && is_production {
            return PolicyDecision {
                decision: PolicyDecisionType::RequireApproval,
                reason: "HIGH risk actions on PRODUCTION require approval even in Full Access mode"
                    .into(),
                risk_level: risk_level.as_str().into(),
                requires_typed_confirmation: false,
                typed_confirmation_prompt: None,
            };
        }

        return PolicyDecision {
            decision: PolicyDecisionType::Allow,
            reason: "Allowed by active Full Access mode".into(),
            risk_level: risk_level.as_str().into(),
            requires_typed_confirmation: false,
            typed_confirmation_prompt: None,
        };
    }

    // 6. Safe Automation mode evaluation
    if permission_mode == PermissionMode::SafeAutomation {
        if *risk_level == RiskLevel::Low && !is_production {
            return PolicyDecision {
                decision: PolicyDecisionType::Allow,
                reason:
                    "Low-risk operation auto-allowed on non-production target in Safe Automation"
                        .into(),
                risk_level: risk_level.as_str().into(),
                requires_typed_confirmation: false,
                typed_confirmation_prompt: None,
            };
        }

        let reason = if is_production {
            format!(
                "{} risk action on PRODUCTION target requires explicit approval",
                risk_level.as_str()
            )
        } else {
            format!(
                "{} risk action requires approval in Safe Automation mode",
                risk_level.as_str()
            )
        };

        return PolicyDecision {
            decision: PolicyDecisionType::RequireApproval,
            reason,
            risk_level: risk_level.as_str().into(),
            requires_typed_confirmation: false,
            typed_confirmation_prompt: None,
        };
    }

    // 7. Approval Required mode: All state-changing operations require approval
    PolicyDecision {
        decision: PolicyDecisionType::RequireApproval,
        reason: format!(
            "State-changing action ({}) requires approval in Approval Required mode",
            risk_level.as_str()
        ),
        risk_level: risk_level.as_str().into(),
        requires_typed_confirmation: false,
        typed_confirmation_prompt: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_mock_server(env: &str) -> ServerRecord {
        ServerRecord {
            id: "srv-001".into(),
            name: "test-server".into(),
            hostname: "192.168.1.10".into(),
            port: 22,
            username: "root".into(),
            environment: env.into(),
            auth_method: "SSH_KEY".into(),
            credential_ref: Some("vault:ssh:test".into()),
            ssh_key_path: None,
            ssh_config_alias: None,
            cpanel_enabled: false,
            whm_port: None,
            whm_token_ref: None,
            tags_json: "[]".into(),
            created_at: "2026-09-19T00:00:00Z".into(),
            updated_at: "2026-09-19T00:00:00Z".into(),
        }
    }

    #[test]
    fn test_target_resolution_gate_b() {
        // Remote tool without target server must be DENIED
        let decision = evaluate_policy(
            "ssh",
            &RiskLevel::ReadOnly,
            None,
            PermissionMode::FullAccess,
            None,
        );
        assert_eq!(decision.decision, PolicyDecisionType::Deny);
    }

    #[test]
    fn test_read_only_auto_allow() {
        let server = create_mock_server("PRODUCTION");
        let decision = evaluate_policy(
            "server",
            &RiskLevel::ReadOnly,
            Some(&server),
            PermissionMode::ApprovalRequired,
            None,
        );
        assert_eq!(decision.decision, PolicyDecisionType::Allow);
    }

    #[test]
    fn test_destructive_heuristic_typed_confirmation() {
        let server = create_mock_server("PRODUCTION");
        let decision = evaluate_policy(
            "ssh",
            &RiskLevel::Medium,
            Some(&server),
            PermissionMode::FullAccess,
            Some("rm -rf /"),
        );
        assert_eq!(
            decision.decision,
            PolicyDecisionType::RequireTypedConfirmation
        );
        assert!(decision.requires_typed_confirmation);
        assert!(decision
            .typed_confirmation_prompt
            .unwrap()
            .contains("Type 'test-server'"));
    }

    #[test]
    fn test_safe_automation_environment_differentiation() {
        let dev_server = create_mock_server("DEVELOPMENT");
        let prod_server = create_mock_server("PRODUCTION");

        // LOW risk on DEV -> Auto allow
        let dec_dev = evaluate_policy(
            "ssh",
            &RiskLevel::Low,
            Some(&dev_server),
            PermissionMode::SafeAutomation,
            None,
        );
        assert_eq!(dec_dev.decision, PolicyDecisionType::Allow);

        // LOW risk on PROD -> Require approval
        let dec_prod = evaluate_policy(
            "ssh",
            &RiskLevel::Low,
            Some(&prod_server),
            PermissionMode::SafeAutomation,
            None,
        );
        assert_eq!(dec_prod.decision, PolicyDecisionType::RequireApproval);
    }

    #[test]
    fn test_full_access_high_risk_on_production() {
        let prod_server = create_mock_server("PRODUCTION");

        let dec = evaluate_policy(
            "ssh",
            &RiskLevel::High,
            Some(&prod_server),
            PermissionMode::FullAccess,
            None,
        );
        // Even in Full Access, HIGH on PRODUCTION prompts user
        assert_eq!(dec.decision, PolicyDecisionType::RequireApproval);
    }
}
