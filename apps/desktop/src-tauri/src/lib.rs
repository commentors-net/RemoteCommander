//! RemoteCommander Desktop Core
//! Foundation, local persistence, and security runtime for AI Operations Assistant.

pub mod alpha;
pub mod approval;
pub mod commands;
pub mod cpanel;
pub mod database;
pub mod error;
pub mod logging;
pub mod models;
pub mod multi_server;
pub mod policy;
pub mod safety;
pub mod secret;
pub mod server_ops;
pub mod sftp;
pub mod ssh;
pub mod terminal;
pub mod tools;
pub mod updater;

use database::Database;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub mod app_info {
    pub const APP_NAME: &str = "RemoteCommander";
    pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
    pub const DEFAULT_WHM_PORT: u16 = 2087;
    pub const DEFAULT_SSH_PORT: u16 = 22;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RiskLevel {
    #[serde(rename = "READ_ONLY")]
    ReadOnly,
    #[serde(rename = "LOW")]
    Low,
    #[serde(rename = "MEDIUM")]
    Medium,
    #[serde(rename = "HIGH")]
    High,
    #[serde(rename = "CRITICAL")]
    Critical,
}

impl RiskLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            RiskLevel::ReadOnly => "READ_ONLY",
            RiskLevel::Low => "LOW",
            RiskLevel::Medium => "MEDIUM",
            RiskLevel::High => "HIGH",
            RiskLevel::Critical => "CRITICAL",
        }
    }

    pub fn requires_explicit_approval(&self, full_access_enabled: bool) -> bool {
        if full_access_enabled {
            matches!(self, RiskLevel::Critical)
        } else {
            !matches!(self, RiskLevel::ReadOnly)
        }
    }
}

/// Initialize SQLite database in default app data dir or in-memory fallback
pub fn init_database(db_path: Option<PathBuf>) -> Result<Database, error::AppError> {
    if let Some(path) = db_path {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| error::AppError::Database(e.to_string()))?;
        }
        Database::new(&path)
    } else {
        Database::in_memory()
    }
}

/// Run Tauri Desktop Application
#[cfg(not(test))]
pub fn run() {
    use approval::ApprovalManager;
    use secret::SecretService;
    use terminal::TerminalManager;
    use tools::ToolRegistry;

    logging::init_logging();

    let default_db_path =
        dirs::data_dir().map(|d| d.join("RemoteCommander").join("remote_commander.db"));
    let db = init_database(default_db_path).unwrap_or_else(|e| {
        tracing::error!(
            "Failed to initialize persistent database at default path, falling back to in-memory: {}",
            e
        );
        Database::in_memory().expect("Failed to initialize database")
    });
    let secret_service = SecretService::with_os_keyring();
    let tool_registry = ToolRegistry::new();
    let approval_manager = ApprovalManager::new();
    let terminal_manager = TerminalManager::new();
    let sftp_manager = sftp::SftpManager::new();
    let safety_manager = safety::SafetyManager::new();

    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            for window in app.webview_windows().values() {
                let _ = window.center();
            }
            Ok(())
        })
        .manage(db)
        .manage(secret_service)
        .manage(tool_registry)
        .manage(approval_manager)
        .manage(terminal_manager)
        .manage(sftp_manager)
        .manage(safety_manager)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_setting,
            commands::set_setting,
            commands::list_settings,
            commands::list_servers,
            commands::save_server,
            commands::delete_server,
            commands::list_audit_events,
            commands::record_audit_event,
            commands::prune_audit_events,
            commands::check_for_updates,
            commands::verify_release_integrity,
            commands::get_sbom_metadata,
            commands::install_update,
            commands::save_secret,
            commands::list_credential_refs,
            commands::delete_secret,
            commands::get_secret,
            commands::list_tool_definitions,
            commands::evaluate_and_execute_tool,
            commands::submit_approval,
            commands::list_pending_approvals,
            commands::list_tool_calls,
            commands::test_server_connection,
            commands::accept_server_host_key,
            commands::list_discovered_ssh_config_hosts,
            commands::list_known_hosts,
            commands::start_terminal_session,
            commands::send_terminal_input,
            commands::read_terminal_output,
            commands::resize_terminal,
            commands::interrupt_terminal,
            commands::terminate_terminal_session,
            commands::list_terminal_sessions,
            commands::sftp_list_directory,
            commands::sftp_read_file,
            commands::sftp_write_file,
            commands::sftp_file_info,
            commands::sftp_delete_file,
            commands::sftp_create_directory,
            commands::safety_create_backup,
            commands::safety_restore_backup,
            commands::safety_list_backups,
            commands::safety_execute_safe_patch,
            commands::safety_set_full_access_expiry,
            commands::safety_get_full_access_status,
            commands::server_system_info,
            commands::server_disk_usage,
            commands::server_memory_usage,
            commands::server_cpu_usage,
            commands::server_load_average,
            commands::server_process_list,
            commands::server_network_connections,
            commands::server_service_status,
            commands::server_service_action,
            commands::server_tail_log,
            commands::cpanel_server_info,
            commands::cpanel_list_accounts,
            commands::cpanel_account_info,
            commands::cpanel_list_domains,
            commands::cpanel_service_status,
            commands::cpanel_restart_service,
            commands::cpanel_ssl_status,
            commands::cpanel_backup_status,
            commands::cpanel_account_disk_usage,
            commands::cpanel_list_php_versions,
            commands::cpanel_suspend_account,
            commands::cpanel_unsuspend_account,
            commands::multi_server_resolve_targets,
            commands::multi_server_evaluate_policy,
            commands::multi_server_execute_batch,
            commands::multi_server_diagnostics_matrix,
            commands::export_audit_log,
            commands::get_alpha_readiness_report,
            commands::check_database_integrity,
            commands::vacuum_database,
            commands::save_conversation,
            commands::list_conversations,
            commands::get_conversation,
            commands::delete_conversation,
            commands::save_message,
            commands::list_messages,
            commands::write_app_log,
            commands::get_app_log_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RemoteCommander desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_info() {
        assert_eq!(app_info::APP_NAME, "RemoteCommander");
        assert_eq!(app_info::DEFAULT_WHM_PORT, 2087);
        assert_eq!(app_info::DEFAULT_SSH_PORT, 22);
    }

    #[test]
    fn test_risk_level_approval_invariants() {
        assert!(!RiskLevel::ReadOnly.requires_explicit_approval(false));
        assert!(RiskLevel::Low.requires_explicit_approval(false));
        assert!(RiskLevel::Medium.requires_explicit_approval(false));
        assert!(RiskLevel::High.requires_explicit_approval(false));
        assert!(RiskLevel::Critical.requires_explicit_approval(false));

        assert!(RiskLevel::Critical.requires_explicit_approval(true));
        assert!(!RiskLevel::Low.requires_explicit_approval(true));
    }

    #[test]
    fn test_init_database_persistent_and_fallback() {
        let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
        let db_path = temp_dir.path().join("subfolder").join("test_rc.db");
        let db = init_database(Some(db_path.clone())).expect("Persistent db should initialize");
        assert!(db_path.exists());
        assert!(db.list_servers().is_ok());

        let mem_db = init_database(None).expect("In-memory db should initialize");
        assert!(mem_db.list_servers().is_ok());
    }
}
