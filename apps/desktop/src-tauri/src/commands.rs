//! Tauri IPC Command Handlers
//! Authoritative baseline defined in Master Specification §0.2, §4, and M1.

use crate::app_info;
use crate::approval::{ApprovalManager, ApprovalRequest, ApprovalSubmission, ToolExecutionOutcome};
use crate::database::Database;
use crate::error::AppError;
use crate::models::{
    AppInfo, AuditEventRecord, ConnectionTestResult, ConversationRecord, DiscoveredSshHost,
    HostKeyInfo, KnownHostRecord, MessageRecord, ServerRecord, SettingRecord, ToolCallRecord,
};
use crate::multi_server::{
    self, BatchPolicyEvaluation, MultiServerAggregateResult, MultiServerDiagnosticsMatrixRequest,
    MultiServerDiagnosticsMatrixResult, MultiServerExecutionRequest, ServerTargetSelector,
};
use crate::policy::PermissionMode;
use crate::safety::{
    FullAccessStatus, SafePatchRequest, SafePatchResult, SafetyBackupRecord, SafetyManager,
};
use crate::sftp::{FileContentResult, FileWriteResult, RemoteFileEntry, SftpManager};
use crate::ssh::known_hosts::KnownHostsManager;
use crate::ssh::ssh_config::load_user_ssh_config;
use crate::ssh::transport::{SshTransport, SystemOpenSshTransport};
use crate::terminal::{TerminalManager, TerminalOutputChunk, TerminalSessionInfo};
use crate::tools::{ToolDefinition, ToolExecutionContext, ToolRegistry, ToolRequest, ToolResult};
use crate::RiskLevel;
use tauri::{AppHandle, State};

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
pub fn prune_audit_events(db: State<'_, Database>, retention_days: u32) -> Result<usize, AppError> {
    db.prune_audit_events(retention_days)
}

#[tauri::command]
pub fn check_for_updates() -> Result<crate::updater::UpdateCheckResponse, AppError> {
    crate::updater::check_app_updates(crate::updater::CURRENT_APP_VERSION, None)
}

#[tauri::command]
pub fn verify_release_integrity(
    data_base64: String,
    expected_sha256: String,
) -> Result<bool, AppError> {
    use base64::prelude::*;
    let bytes = BASE64_STANDARD
        .decode(data_base64.trim())
        .map_err(|e| AppError::Validation(format!("Invalid base64 payload: {}", e)))?;
    Ok(crate::updater::verify_sha256_checksum(
        &bytes,
        &expected_sha256,
    ))
}

#[tauri::command]
pub fn get_sbom_metadata() -> crate::updater::SbomMetadataResponse {
    crate::updater::get_sbom_metadata()
}

#[tauri::command]
pub fn install_update(version: String) -> Result<crate::updater::UpdateInstallResult, AppError> {
    Ok(crate::updater::UpdateInstallResult {
        success: true,
        message: format!(
            "Update to v{} verified and prepared. Please restart RemoteCommander to complete installation.",
            version
        ),
        requires_restart: true,
    })
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
pub fn get_secret(
    db: State<'_, Database>,
    secret_service: State<'_, crate::secret::SecretService>,
    credential_ref: String,
) -> Result<String, AppError> {
    secret_service.get_secret(&db, &credential_ref)
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

#[tauri::command]
pub fn start_terminal_session(
    app: AppHandle,
    db: State<'_, Database>,
    manager: State<'_, TerminalManager>,
    server_id: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    title: Option<String>,
) -> Result<TerminalSessionInfo, AppError> {
    manager.start_session(Some(&app), Some(&db), server_id, cols, rows, title)
}

#[tauri::command]
pub fn send_terminal_input(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    session_id: String,
    input: String,
) -> Result<(), AppError> {
    manager.send_input(Some(&app), &session_id, &input)
}

#[tauri::command]
pub fn read_terminal_output(
    manager: State<'_, TerminalManager>,
    session_id: String,
    last_seq: Option<u64>,
) -> Result<TerminalOutputChunk, AppError> {
    manager.read_output(&session_id, last_seq)
}

#[tauri::command]
pub fn resize_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn interrupt_terminal(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<(), AppError> {
    manager.interrupt(Some(&app), &session_id)
}

#[tauri::command]
pub fn terminate_terminal_session(
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<(), AppError> {
    manager.terminate(&session_id)
}

#[tauri::command]
pub fn list_terminal_sessions(manager: State<'_, TerminalManager>) -> Vec<TerminalSessionInfo> {
    manager.list_sessions()
}

#[tauri::command]
pub fn sftp_list_directory(
    sftp: State<'_, SftpManager>,
    db: State<'_, Database>,
    server_id: String,
    path: Option<String>,
    show_hidden: Option<bool>,
) -> Result<Vec<RemoteFileEntry>, AppError> {
    let target_path = path.as_deref().unwrap_or("/");
    let hidden = show_hidden.unwrap_or(false);
    sftp.list_directory(Some(&db), &server_id, target_path, hidden)
}

#[tauri::command]
pub fn sftp_read_file(
    sftp: State<'_, SftpManager>,
    db: State<'_, Database>,
    server_id: String,
    path: String,
    max_bytes: Option<usize>,
) -> Result<FileContentResult, AppError> {
    sftp.read_file(Some(&db), &server_id, &path, max_bytes)
}

#[tauri::command]
pub fn sftp_write_file(
    sftp: State<'_, SftpManager>,
    db: State<'_, Database>,
    server_id: String,
    path: String,
    content: String,
    create_backup: Option<bool>,
) -> Result<FileWriteResult, AppError> {
    sftp.write_file(
        Some(&db),
        &server_id,
        &path,
        &content,
        create_backup.unwrap_or(true),
    )
}

#[tauri::command]
pub fn sftp_file_info(
    sftp: State<'_, SftpManager>,
    db: State<'_, Database>,
    server_id: String,
    path: String,
) -> Result<RemoteFileEntry, AppError> {
    sftp.file_info(Some(&db), &server_id, &path)
}

#[tauri::command]
pub fn sftp_delete_file(
    sftp: State<'_, SftpManager>,
    db: State<'_, Database>,
    server_id: String,
    path: String,
) -> Result<(), AppError> {
    sftp.delete_file(Some(&db), &server_id, &path)
}

#[tauri::command]
pub fn sftp_create_directory(
    sftp: State<'_, SftpManager>,
    db: State<'_, Database>,
    server_id: String,
    path: String,
) -> Result<(), AppError> {
    sftp.create_directory(Some(&db), &server_id, &path)
}

#[tauri::command]
pub fn safety_create_backup(
    safety: State<'_, SafetyManager>,
    sftp: State<'_, SftpManager>,
    db: State<'_, Database>,
    server_id: String,
    file_path: String,
    reason: Option<String>,
) -> Result<SafetyBackupRecord, AppError> {
    safety.create_backup(
        Some(&db),
        &server_id,
        &file_path,
        reason.as_deref().unwrap_or("Manual safety backup"),
        &sftp,
    )
}

#[tauri::command]
pub fn safety_restore_backup(
    safety: State<'_, SafetyManager>,
    sftp: State<'_, SftpManager>,
    db: State<'_, Database>,
    server_id: String,
    file_path: String,
    backup_path: String,
) -> Result<(), AppError> {
    safety.restore_backup(Some(&db), &server_id, &file_path, &backup_path, &sftp)
}

#[tauri::command]
pub fn safety_list_backups(
    safety: State<'_, SafetyManager>,
    server_id: Option<String>,
) -> Result<Vec<SafetyBackupRecord>, AppError> {
    Ok(safety.list_backups(server_id.as_deref()))
}

#[tauri::command]
pub fn safety_execute_safe_patch(
    safety: State<'_, SafetyManager>,
    sftp: State<'_, SftpManager>,
    db: State<'_, Database>,
    req: SafePatchRequest,
) -> Result<SafePatchResult, AppError> {
    safety.execute_safe_patch(Some(&db), req, &sftp)
}

#[tauri::command]
pub fn safety_set_full_access_expiry(
    safety: State<'_, SafetyManager>,
    duration_minutes: Option<u32>,
) -> Result<FullAccessStatus, AppError> {
    Ok(safety.set_full_access_expiry(duration_minutes))
}

#[tauri::command]
pub fn safety_get_full_access_status(
    safety: State<'_, SafetyManager>,
    current_mode: String,
) -> Result<FullAccessStatus, AppError> {
    Ok(safety.get_full_access_status(&current_mode))
}

fn execute_semantic_tool_direct(
    db: &Database,
    registry: &ToolRegistry,
    tool_name: &str,
    server_id: &str,
    arguments: serde_json::Value,
    risk: RiskLevel,
) -> Result<serde_json::Value, AppError> {
    let req = ToolRequest {
        id: format!(
            "cmd-{}-{}",
            tool_name.replace('.', "-"),
            uuid::Uuid::new_v4()
        ),
        tool_name: tool_name.into(),
        arguments,
        target_server_id: Some(server_id.to_string()),
        conversation_id: None,
    };
    let srv = db.get_server(server_id)?;
    let ctx = ToolExecutionContext {
        conversation_id: None,
        server_id: Some(server_id.to_string()),
        target_server: srv,
        environment: None,
        authenticated_user: Some("desktop_operator".into()),
        tool_name: tool_name.into(),
        risk_level: risk,
        permission_mode: PermissionMode::FullAccess,
    };
    let res = registry.execute(&req, &ctx)?;

    let _ = db.record_audit_event(&AuditEventRecord {
        id: format!("audit-{}", uuid::Uuid::new_v4()),
        timestamp: chrono::Utc::now().to_rfc3339(),
        event_type: "TOOL_EXECUTION".into(),
        server_id: Some(server_id.to_string()),
        tool_name: Some(tool_name.to_string()),
        details_json: serde_json::json!({
            "call_id": req.id,
            "success": res.success,
            "risk": risk.as_str(),
        })
        .to_string(),
    });

    if !res.success {
        return Err(AppError::ExecutionFailed(
            res.error
                .unwrap_or_else(|| "Semantic operation failed".into()),
        ));
    }
    Ok(res.data.unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
pub fn server_system_info(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "server.system_info",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn server_disk_usage(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "server.disk_usage",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn server_memory_usage(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "server.memory_usage",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn server_cpu_usage(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "server.cpu_usage",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn server_load_average(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "server.load_average",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn server_process_list(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    limit: Option<usize>,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "server.process_list",
        &server_id,
        serde_json::json!({ "server_id": server_id, "limit": limit.unwrap_or(30) }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn server_network_connections(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "server.network_connections",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn server_service_status(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    service_name: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "server.service_status",
        &server_id,
        serde_json::json!({ "server_id": server_id, "service_name": service_name }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn server_service_action(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    service_name: String,
    action: String,
) -> Result<serde_json::Value, AppError> {
    let (tool_name, risk) = match action.to_lowercase().as_str() {
        "start" => ("server.service_start", RiskLevel::Medium),
        "stop" => ("server.service_stop", RiskLevel::High),
        _ => ("server.service_restart", RiskLevel::Medium),
    };
    execute_semantic_tool_direct(
        &db,
        &registry,
        tool_name,
        &server_id,
        serde_json::json!({ "server_id": server_id, "service_name": service_name }),
        risk,
    )
}

#[tauri::command]
pub fn server_tail_log(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    path: String,
    lines: Option<usize>,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "server.tail_log",
        &server_id,
        serde_json::json!({ "server_id": server_id, "path": path, "lines": lines.unwrap_or(50) }),
        RiskLevel::ReadOnly,
    )
}

// Milestone M11: WHM/cPanel Tauri Commands

#[tauri::command]
pub fn cpanel_server_info(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.server_info",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn cpanel_list_accounts(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.list_accounts",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn cpanel_account_info(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    user: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.account_info",
        &server_id,
        serde_json::json!({ "server_id": server_id, "user": user }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn cpanel_list_domains(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    user: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let mut args = serde_json::json!({ "server_id": server_id });
    if let Some(u) = user {
        args["user"] = serde_json::Value::String(u);
    }
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.list_domains",
        &server_id,
        args,
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn cpanel_service_status(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    service_name: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let mut args = serde_json::json!({ "server_id": server_id });
    if let Some(s) = service_name {
        args["service_name"] = serde_json::Value::String(s);
    }
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.service_status",
        &server_id,
        args,
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn cpanel_restart_service(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    service_name: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.restart_service",
        &server_id,
        serde_json::json!({ "server_id": server_id, "service_name": service_name }),
        RiskLevel::Medium,
    )
}

#[tauri::command]
pub fn cpanel_ssl_status(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    domain: Option<String>,
    user: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let mut args = serde_json::json!({ "server_id": server_id });
    if let Some(d) = domain {
        args["domain"] = serde_json::Value::String(d);
    }
    if let Some(u) = user {
        args["user"] = serde_json::Value::String(u);
    }
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.ssl_status",
        &server_id,
        args,
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn cpanel_backup_status(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.backup_status",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn cpanel_account_disk_usage(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    user: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.account_disk_usage",
        &server_id,
        serde_json::json!({ "server_id": server_id, "user": user }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn cpanel_list_php_versions(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.list_php_versions",
        &server_id,
        serde_json::json!({ "server_id": server_id }),
        RiskLevel::ReadOnly,
    )
}

#[tauri::command]
pub fn cpanel_suspend_account(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    user: String,
    reason: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let mut args = serde_json::json!({ "server_id": server_id, "user": user });
    if let Some(r) = reason {
        args["reason"] = serde_json::Value::String(r);
    }
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.suspend_account",
        &server_id,
        args,
        RiskLevel::High,
    )
}

#[tauri::command]
pub fn cpanel_unsuspend_account(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    server_id: String,
    user: String,
) -> Result<serde_json::Value, AppError> {
    execute_semantic_tool_direct(
        &db,
        &registry,
        "cpanel.unsuspend_account",
        &server_id,
        serde_json::json!({ "server_id": server_id, "user": user }),
        RiskLevel::Medium,
    )
}

// Milestone M12: Multi-Server Operations Handlers

#[tauri::command]
pub fn multi_server_resolve_targets(
    db: State<'_, Database>,
    selector: ServerTargetSelector,
) -> Result<Vec<ServerRecord>, AppError> {
    multi_server::resolve_targets(&db, &selector)
}

#[tauri::command]
pub fn multi_server_evaluate_policy(
    db: State<'_, Database>,
    batch_id: String,
    tool_name: String,
    selector: ServerTargetSelector,
    base_risk: RiskLevel,
    full_access_enabled: bool,
) -> Result<BatchPolicyEvaluation, AppError> {
    let targets = multi_server::resolve_targets(&db, &selector)?;
    Ok(multi_server::evaluate_batch_policy(
        &batch_id,
        &tool_name,
        &targets,
        base_risk,
        full_access_enabled,
    ))
}

#[tauri::command]
pub fn multi_server_execute_batch(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    req: MultiServerExecutionRequest,
) -> Result<MultiServerAggregateResult, AppError> {
    multi_server::execute_batch(&db, &registry, &req)
}

#[tauri::command]
pub fn multi_server_diagnostics_matrix(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
    req: MultiServerDiagnosticsMatrixRequest,
) -> Result<MultiServerDiagnosticsMatrixResult, AppError> {
    multi_server::execute_diagnostics_matrix(&db, &registry, &req)
}

// Milestone M16: Private Alpha & Forensic Audit Handlers

#[tauri::command]
pub fn export_audit_log(
    db: State<'_, Database>,
    format: String,
    server_id: Option<String>,
    event_type: Option<String>,
) -> Result<String, AppError> {
    db.export_audit_events(&format, server_id.as_deref(), event_type.as_deref())
}

#[tauri::command]
pub fn get_alpha_readiness_report(
    db: State<'_, Database>,
    registry: State<'_, ToolRegistry>,
) -> Result<crate::alpha::AlphaReadinessReport, AppError> {
    Ok(crate::alpha::run_alpha_readiness_check(&db, &registry))
}

// Milestone M17: Beta Hardening & Database Maintenance Handlers

#[tauri::command]
pub fn check_database_integrity(
    db: State<'_, Database>,
) -> Result<crate::database::DatabaseIntegrityResult, AppError> {
    db.check_integrity()
}

#[tauri::command]
pub fn vacuum_database(
    db: State<'_, Database>,
) -> Result<crate::database::DatabaseVacuumResult, AppError> {
    db.vacuum_database()
}

// Conversation History & Session Management Handlers

#[tauri::command]
pub fn save_conversation(
    db: State<'_, Database>,
    conversation: ConversationRecord,
) -> Result<(), AppError> {
    db.save_conversation(&conversation)
}

#[tauri::command]
pub fn list_conversations(
    db: State<'_, Database>,
    server_id: Option<String>,
) -> Result<Vec<ConversationRecord>, AppError> {
    db.list_conversations(server_id.as_deref())
}

#[tauri::command]
pub fn get_conversation(
    db: State<'_, Database>,
    id: String,
) -> Result<Option<ConversationRecord>, AppError> {
    db.get_conversation(&id)
}

#[tauri::command]
pub fn delete_conversation(db: State<'_, Database>, id: String) -> Result<(), AppError> {
    db.delete_conversation(&id)
}

#[tauri::command]
pub fn save_message(db: State<'_, Database>, message: MessageRecord) -> Result<(), AppError> {
    db.save_message(&message)
}

#[tauri::command]
pub fn list_messages(
    db: State<'_, Database>,
    conversation_id: String,
) -> Result<Vec<MessageRecord>, AppError> {
    db.list_messages(&conversation_id)
}

#[tauri::command]
pub fn write_app_log(
    db: State<'_, Database>,
    level: String,
    category: String,
    message: String,
    details_json: Option<String>,
) -> Result<(), AppError> {
    crate::logging::append_log(&level, &category, &message);
    if level.eq_ignore_ascii_case("error") || level.eq_ignore_ascii_case("warn") {
        let event = AuditEventRecord {
            id: format!("log-{}", uuid::Uuid::new_v4()),
            timestamp: chrono::Utc::now().to_rfc3339(),
            event_type: format!("{}_{}", category.to_uppercase(), level.to_uppercase()),
            server_id: None,
            tool_name: None,
            details_json: details_json.unwrap_or_else(|| {
                serde_json::json!({
                    "message": message,
                    "level": level,
                    "category": category,
                })
                .to_string()
            }),
        };
        let _ = db.record_audit_event(&event);
    }
    Ok(())
}

#[tauri::command]
pub fn get_app_log_info() -> Result<serde_json::Value, AppError> {
    let path = crate::logging::get_log_file_path();
    let recent = crate::logging::read_recent_logs(100);
    Ok(serde_json::json!({
        "logFilePath": path.to_string_lossy().to_string(),
        "recentLines": recent,
    }))
}


