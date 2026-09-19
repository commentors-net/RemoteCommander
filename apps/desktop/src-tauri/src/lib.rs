//! RemoteCommander Desktop Core
//! Foundation, local persistence, and security runtime for AI Operations Assistant.

pub mod approval;
pub mod commands;
pub mod database;
pub mod error;
pub mod logging;
pub mod models;
pub mod policy;
pub mod secret;
pub mod ssh;
pub mod tools;

use approval::ApprovalManager;
use database::Database;
use secret::SecretService;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tools::ToolRegistry;

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
pub fn run() {
    logging::init_logging();

    let db = Database::in_memory().expect("Failed to initialize database");
    let secret_service = SecretService::with_os_keyring();
    let tool_registry = ToolRegistry::new();
    let approval_manager = ApprovalManager::new();

    tauri::Builder::default()
        .manage(db)
        .manage(secret_service)
        .manage(tool_registry)
        .manage(approval_manager)
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
            commands::save_secret,
            commands::list_credential_refs,
            commands::delete_secret,
            commands::list_tool_definitions,
            commands::evaluate_and_execute_tool,
            commands::submit_approval,
            commands::list_pending_approvals,
            commands::list_tool_calls,
            commands::test_server_connection,
            commands::accept_server_host_key,
            commands::list_discovered_ssh_config_hosts,
            commands::list_known_hosts,
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
}
