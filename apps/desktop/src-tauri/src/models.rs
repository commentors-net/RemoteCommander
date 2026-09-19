//! Data models for SQLite local persistence
//! Plaintext secrets are strictly forbidden from these models.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SettingRecord {
    pub key: String,
    pub value_json: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerRecord {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub environment: String, // 'DEVELOPMENT', 'STAGING', 'PRODUCTION'
    pub auth_method: String, // 'SSH_KEY', 'SSH_AGENT', 'PASSWORD'
    pub credential_ref: Option<String>, // Opaque ID in OS keyring (NEVER plaintext)
    pub ssh_key_path: Option<String>,
    pub ssh_config_alias: Option<String>,
    pub cpanel_enabled: bool,
    pub whm_port: Option<u16>,
    pub whm_token_ref: Option<String>,
    pub tags_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuditEventRecord {
    pub id: String,
    pub timestamp: String,
    pub event_type: String,
    pub server_id: Option<String>,
    pub tool_name: Option<String>,
    pub details_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub default_ssh_port: u16,
    pub default_whm_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolCallRecord {
    pub id: String,
    pub conversation_id: Option<String>,
    pub server_id: Option<String>,
    pub tool_name: String,
    pub arguments_json: String,
    pub risk_level: String,
    pub status: String,
    pub requested_at: String,
    pub approved_at: Option<String>,
    pub approved_by: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<i64>,
    pub stdout_summary: Option<String>,
    pub stderr_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApprovalRecord {
    pub id: String,
    pub tool_call_id: String,
    pub decision: String,
    pub mode: String,
    pub typed_acknowledgement: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostKeyInfo {
    pub key_type: String,
    pub public_key_base64: String,
    pub fingerprint_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status")]
pub enum HostKeyStatus {
    #[serde(rename = "TRUSTED")]
    Trusted,
    #[serde(rename = "NEW_HOST")]
    NewHost { host_key: HostKeyInfo },
    #[serde(rename = "CHANGED_WARNING")]
    ChangedWarning {
        previous_fingerprint: String,
        new_fingerprint: String,
        new_key_type: String,
    },
    #[serde(rename = "REVOKED")]
    Revoked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub server_id: String,
    pub server_name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub host_key: Option<HostKeyInfo>,
    pub host_key_status: String,
    pub previous_fingerprint: Option<String>,
    pub new_fingerprint: Option<String>,
    pub latency_ms: u64,
    pub server_version_banner: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiscoveredSshHost {
    pub alias: String,
    pub hostname: String,
    pub port: u16,
    pub username: Option<String>,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnownHostRecord {
    pub id: String,
    pub hostname: String,
    pub port: u16,
    pub key_type: String,
    pub public_key_base64: String,
    pub fingerprint_sha256: String,
    pub first_seen_at: String,
    pub last_verified_at: String,
    pub status: String,
}
