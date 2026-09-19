//! Tauri IPC Command Handlers
//! Authoritative baseline defined in Master Specification §0.2, §4, and M1.

use crate::app_info;
use crate::approval::{ApprovalManager, ApprovalRequest, ApprovalSubmission, ToolExecutionOutcome};
use crate::database::Database;
use crate::error::AppError;
use crate::models::{
    AppInfo, AuditEventRecord, ConnectionTestResult, DiscoveredSshHost, HostKeyInfo,
    KnownHostRecord, ServerRecord, SettingRecord, ToolCallRecord,
};
use crate::policy::PermissionMode;
use crate::ssh::known_hosts::KnownHostsManager;
use crate::ssh::ssh_config::load_user_ssh_config;
use crate::ssh::transport::{SshTransport, SystemOpenSshTransport};
use crate::tools::{ToolDefinition, ToolRegistry, ToolRequest, ToolResult};
use tauri::State;

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: app_info::APP_NAME.to_string(),
        version: app_info::APP_VERSION.to_string(),
        default_ssh_port: app_info::DEFAULT_SSH_PORT,
        default_whm_port: app_info::DEFAULT_WHM_PORT,
    }
}

#[tauri::command]
pub fn get_setting(db: State<'_, Database>, key: String) -> Result<Option<String>, AppError> {
    db.get_setting(&key)
}

#[tauri::command]
pub fn set_setting(
    db: State<'_, Database>,
    key: String,
    value_json: String,
) -> Result<(), AppError> {
    db.set_setting(&key, &value_json)
}

#[tauri::command]
pub fn list_settings(db: State<'_, Database>) -> Result<Vec<SettingRecord>, AppError> {
    db.list_settings()
}

#[tauri::command]
pub fn list_servers(db: State<'_, Database>) -> Result<Vec<ServerRecord>, AppError> {
    db.list_servers()
}

#[tauri::command]
pub fn save_server(db: State<'_, Database>, server: ServerRecord) -> Result<(), AppError> {
    db.save_server(&server)
}

#[tauri::command]
pub fn delete_server(db: State<'_, Database>, id: String) -> Result<(), AppError> {
    db.delete_server(&id)
}

#[tauri::command]
pub fn list_audit_events(
    db: State<'_, Database>,
    limit: Option<u32>,
) -> Result<Vec<AuditEventRecord>, AppError> {
    db.list_audit_events(limit)
}

#[tauri::command]
pub fn record_audit_event(
    db: State<'_, Database>,
    event: AuditEventRecord,
) -> Result<(), AppError> {
    db.record_audit_event(&event)
}

#[tauri::command]
pub fn save_secret(
    db: State<'_, Database>,
    secret_service: State<'_, crate::secret::SecretService>,
    secret_type: String,
    label: String,
    secret_value: String,
) -> Result<crate::secret::CredentialRefRecord, AppError> {
    secret_service.save_secret(&db, &secret_type, &label, &secret_value)
}

#[tauri::command]
pub fn list_credential_refs(
    db: State<'_, Database>,
    secret_service: State<'_, crate::secret::SecretService>,
) -> Result<Vec<crate::secret::CredentialRefRecord>, AppError> {
    secret_service.list_credentials(&db)
}

#[tauri::command]
pub fn delete_secret(
    db: State<'_, Database>,
    secret_service: State<'_, crate::secret::SecretService>,
    credential_ref: String,
) -> Result<(), AppError> {
    secret_service.delete_secret(&db, &credential_ref)
}

#[tauri::command]
pub fn list_tool_definitions(registry: State<'_, ToolRegistry>) -> Vec<ToolDefinition> {
    registry.list()
}

#[tauri::command]
pub fn evaluate_and_execute_tool(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    approval_mgr: State<'_, ApprovalManager>,
    request: ToolRequest,
    permission_mode: Option<String>,
) -> Result<ToolExecutionOutcome, AppError> {
    let mode = permission_mode
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(PermissionMode::ApprovalRequired);

    approval_mgr.evaluate_and_stage(&db, &registry, request, mode, Some("desktop_user".into()))
}

#[tauri::command]
pub fn submit_approval(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    approval_mgr: State<'_, ApprovalManager>,
    submission: ApprovalSubmission,
) -> Result<ToolResult, AppError> {
    approval_mgr.submit_approval(&db, &registry, submission)
}

#[tauri::command]
pub fn list_pending_approvals(approval_mgr: State<'_, ApprovalManager>) -> Vec<ApprovalRequest> {
    approval_mgr.list_pending()
}

#[tauri::command]
pub fn list_tool_calls(
    db: State<'_, Database>,
    limit: Option<u32>,
) -> Result<Vec<ToolCallRecord>, AppError> {
    db.list_tool_calls(limit)
}

#[tauri::command]
pub async fn test_server_connection(
    db: State<'_, Database>,
    server_id: String,
) -> Result<ConnectionTestResult, AppError> {
    let server = db
        .get_server(&server_id)?
        .ok_or_else(|| AppError::ServerNotFound(format!("Server {} not found", server_id)))?;

    let mut known_hosts = KnownHostsManager::from_default_path();
    let transport = SystemOpenSshTransport::new();

    let result = transport
        .test_connection(&server, &mut known_hosts, None)
        .await?;

    // Record audit event
    let event = AuditEventRecord {
        id: format!("evt-ssh-{}", uuid::Uuid::new_v4()),
        timestamp: chrono::Utc::now().to_rfc3339(),
        event_type: "SSH_CONNECTION_TESTED".into(),
        server_id: Some(server.id.clone()),
        tool_name: Some("ssh.test_connection".into()),
        details_json: serde_json::to_string(&result).unwrap_or_else(|_| "{}".into()),
    };
    let _ = db.record_audit_event(&event);

    // If host key is trusted, cache in SQLite known_hosts_cache
    if let Some(ref hk) = result.host_key {
        if result.host_key_status == "TRUSTED" {
            let record = KnownHostRecord {
                id: format!("kh-{}", uuid::Uuid::new_v4()),
                hostname: result.hostname.clone(),
                port: result.port,
                key_type: hk.key_type.clone(),
                public_key_base64: hk.public_key_base64.clone(),
                fingerprint_sha256: hk.fingerprint_sha256.clone(),
                first_seen_at: chrono::Utc::now().to_rfc3339(),
                last_verified_at: chrono::Utc::now().to_rfc3339(),
                status: "TRUSTED".into(),
            };
            let _ = db.save_known_host(&record);
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn accept_server_host_key(
    db: State<'_, Database>,
    server_id: String,
    host_key: HostKeyInfo,
) -> Result<(), AppError> {
    let server = db
        .get_server(&server_id)?
        .ok_or_else(|| AppError::ServerNotFound(format!("Server {} not found", server_id)))?;

    let mut known_hosts = KnownHostsManager::from_default_path();
    known_hosts.accept_and_save(&server.hostname, server.port, &host_key)?;

    let record = KnownHostRecord {
        id: format!("kh-{}", uuid::Uuid::new_v4()),
        hostname: server.hostname.clone(),
        port: server.port,
        key_type: host_key.key_type.clone(),
        public_key_base64: host_key.public_key_base64.clone(),
        fingerprint_sha256: host_key.fingerprint_sha256.clone(),
        first_seen_at: chrono::Utc::now().to_rfc3339(),
        last_verified_at: chrono::Utc::now().to_rfc3339(),
        status: "TRUSTED".into(),
    };
    db.save_known_host(&record)?;

    let event = AuditEventRecord {
        id: format!("evt-ssh-accept-{}", uuid::Uuid::new_v4()),
        timestamp: chrono::Utc::now().to_rfc3339(),
        event_type: "SSH_HOST_KEY_ACCEPTED".into(),
        server_id: Some(server.id),
        tool_name: Some("ssh.accept_host_key".into()),
        details_json: serde_json::to_string(&host_key).unwrap_or_else(|_| "{}".into()),
    };
    let _ = db.record_audit_event(&event);

    Ok(())
}

#[tauri::command]
pub fn list_discovered_ssh_config_hosts() -> Vec<DiscoveredSshHost> {
    load_user_ssh_config()
}

#[tauri::command]
pub fn list_known_hosts(db: State<'_, Database>) -> Result<Vec<KnownHostRecord>, AppError> {
    db.list_known_hosts()
}
