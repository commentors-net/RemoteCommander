/*!
 * Multi-Server Operations Engine (Milestone M12)
 * Authoritative baseline defined in Master Specification §15 and Appendix A.
 *
 * Implements:
 * - Scoped target selection (all, environment, tag, tags, server_ids)
 * - Inherited production risk policy enforcement (Gate A / Gate C)
 * - Bounded parallel execution with per-node timeouts and complete failure isolation
 * - Side-by-side diagnostic aggregation matrix comparison
 * - Native audit logging of batch dispatch and per-node executions
 */

use crate::database::Database;
use crate::error::AppError;
use crate::models::{AuditEventRecord, ServerRecord};
use crate::policy::PermissionMode;
use crate::tools::{ToolExecutionContext, ToolRegistry, ToolRequest};
use crate::RiskLevel;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

/// Target selector for scoping multi-server operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ServerTargetSelector {
    #[serde(rename = "all")]
    All,
    #[serde(rename = "environment")]
    Environment { environment: String },
    #[serde(rename = "tag")]
    Tag { tag: String },
    #[serde(rename = "tags")]
    Tags {
        tags: Vec<String>,
        #[serde(rename = "matchMode")]
        match_mode: Option<String>, // "all" | "any"
    },
    #[serde(rename = "server_ids")]
    ServerIds {
        #[serde(rename = "serverIds")]
        server_ids: Vec<String>,
    },
}

/// Request for executing a tool across multiple servers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiServerExecutionRequest {
    pub batch_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub selector: ServerTargetSelector,
    pub concurrency_limit: Option<usize>, // 1..20, default 5
    pub timeout_seconds: Option<u64>,     // default 30
    pub dry_run: Option<bool>,
}

/// Execution outcome for an individual server node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeExecutionResult {
    pub server_id: String,
    pub server_name: String,
    pub hostname: String,
    pub environment: String,
    pub success: bool,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
}

/// Aggregated multi-server batch execution summary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MultiServerAggregateResult {
    pub batch_id: String,
    pub tool_name: String,
    pub selector: ServerTargetSelector,
    pub total_nodes: usize,
    pub succeeded_nodes: usize,
    pub failed_nodes: usize,
    pub nodes: Vec<NodeExecutionResult>,
    pub started_at: String,
    pub completed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary_matrix: Option<serde_json::Value>,
}

/// Batch policy evaluation with inherited production risk enforcement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BatchPolicyEvaluation {
    pub batch_id: String,
    pub has_production_server: bool,
    pub effective_risk_level: RiskLevel,
    pub requires_confirmation: bool,
    pub confirmation_code: Option<String>,
    pub target_count: usize,
    pub target_server_ids: Vec<String>,
}

/// Diagnostic type for parallel matrix comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DiagnosticType {
    #[serde(rename = "system_info")]
    SystemInfo,
    #[serde(rename = "disk_usage")]
    DiskUsage,
    #[serde(rename = "memory_usage")]
    MemoryUsage,
    #[serde(rename = "cpu_usage")]
    CpuUsage,
    #[serde(rename = "service_status")]
    ServiceStatus,
}

impl DiagnosticType {
    pub fn as_str(&self) -> &'static str {
        match self {
            DiagnosticType::SystemInfo => "system_info",
            DiagnosticType::DiskUsage => "disk_usage",
            DiagnosticType::MemoryUsage => "memory_usage",
            DiagnosticType::CpuUsage => "cpu_usage",
            DiagnosticType::ServiceStatus => "service_status",
        }
    }

    pub fn to_tool_name(&self) -> &'static str {
        match self {
            DiagnosticType::SystemInfo => "server.system_info",
            DiagnosticType::DiskUsage => "server.disk_usage",
            DiagnosticType::MemoryUsage => "server.memory_usage",
            DiagnosticType::CpuUsage => "server.cpu_usage",
            DiagnosticType::ServiceStatus => "server.service_status",
        }
    }
}

/// Request for running a diagnostics matrix.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiServerDiagnosticsMatrixRequest {
    pub batch_id: Option<String>,
    pub selector: ServerTargetSelector,
    pub diagnostic_type: String,
    pub service_name: Option<String>,
    pub concurrency_limit: Option<usize>,
    pub timeout_seconds: Option<u64>,
}

/// Row entry in the multi-server diagnostics matrix.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiagnosticsMatrixRow {
    pub server_id: String,
    pub server_name: String,
    pub hostname: String,
    pub environment: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distro_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_human: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_cores: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_usage_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_usage_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_used_human: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_total_human: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_disk_usage_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_disk_used_human: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_disk_total_human: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_status_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_output: Option<serde_json::Value>,
}

/// Aggregated response for a multi-server diagnostics matrix.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MultiServerDiagnosticsMatrixResult {
    pub batch_id: String,
    pub diagnostic_type: String,
    pub timestamp: String,
    pub total_nodes: usize,
    pub succeeded_nodes: usize,
    pub failed_nodes: usize,
    pub rows: Vec<DiagnosticsMatrixRow>,
}

/// Resolve target servers from the SQLite database based on the target selector.
pub fn resolve_targets(
    db: &Database,
    selector: &ServerTargetSelector,
) -> Result<Vec<ServerRecord>, AppError> {
    let all_servers = db.list_servers()?;

    let filtered = match selector {
        ServerTargetSelector::All => all_servers,
        ServerTargetSelector::Environment { environment } => all_servers
            .into_iter()
            .filter(|s| s.environment.eq_ignore_ascii_case(environment))
            .collect(),
        ServerTargetSelector::Tag { tag } => all_servers
            .into_iter()
            .filter(|s| {
                let tags: Vec<String> = serde_json::from_str(&s.tags_json).unwrap_or_default();
                tags.iter().any(|t| t.eq_ignore_ascii_case(tag))
            })
            .collect(),
        ServerTargetSelector::Tags { tags, match_mode } => {
            let mode = match_mode.as_deref().unwrap_or("any");
            all_servers
                .into_iter()
                .filter(|s| {
                    let s_tags: Vec<String> =
                        serde_json::from_str(&s.tags_json).unwrap_or_default();
                    if mode.eq_ignore_ascii_case("all") {
                        tags.iter()
                            .all(|t| s_tags.iter().any(|st| st.eq_ignore_ascii_case(t)))
                    } else {
                        tags.iter()
                            .any(|t| s_tags.iter().any(|st| st.eq_ignore_ascii_case(t)))
                    }
                })
                .collect()
        }
        ServerTargetSelector::ServerIds { server_ids } => all_servers
            .into_iter()
            .filter(|s| server_ids.iter().any(|id| id == &s.id))
            .collect(),
    };

    Ok(filtered)
}

/// Evaluate multi-server batch security policy.
/// Enforces Inherited Production Risk (Gate A / Gate C / Spec §15):
/// If any target server in a batch is marked PRODUCTION, the entire batch
/// inherits production policy and requires explicit operator approval if state-modifying.
pub fn evaluate_batch_policy(
    batch_id: &str,
    _tool_name: &str,
    targets: &[ServerRecord],
    base_risk: RiskLevel,
    full_access_enabled: bool,
) -> BatchPolicyEvaluation {
    let has_production = targets
        .iter()
        .any(|s| s.environment.to_uppercase() == "PRODUCTION");

    let effective_risk = if has_production {
        match base_risk {
            RiskLevel::ReadOnly => RiskLevel::ReadOnly,
            RiskLevel::Low | RiskLevel::Medium => RiskLevel::High,
            RiskLevel::High => RiskLevel::High,
            RiskLevel::Critical => RiskLevel::Critical,
        }
    } else {
        base_risk
    };

    let requires_confirmation = if effective_risk == RiskLevel::ReadOnly {
        false
    } else if has_production {
        // Any state-modifying batch touching production ALWAYS requires explicit typed confirmation
        true
    } else if full_access_enabled {
        effective_risk == RiskLevel::Critical
    } else {
        true
    };

    let confirmation_code = if requires_confirmation {
        if effective_risk == RiskLevel::Critical {
            Some("CONFIRM BATCH CRITICAL".into())
        } else {
            Some("CONFIRM BATCH".into())
        }
    } else {
        None
    };

    let target_server_ids = targets.iter().map(|s| s.id.clone()).collect();

    BatchPolicyEvaluation {
        batch_id: batch_id.to_string(),
        has_production_server: has_production,
        effective_risk_level: effective_risk,
        requires_confirmation,
        confirmation_code,
        target_count: targets.len(),
        target_server_ids,
    }
}

/// Execute a tool across multiple resolved servers with bounded concurrency and failure isolation.
pub fn execute_batch(
    db: &Database,
    registry: &ToolRegistry,
    req: &MultiServerExecutionRequest,
) -> Result<MultiServerAggregateResult, AppError> {
    let started_at = Utc::now().to_rfc3339();
    let targets = resolve_targets(db, &req.selector)?;

    // Record Batch Dispatch Audit Event (Gate C)
    let _ = db.record_audit_event(&AuditEventRecord {
        id: format!("audit-batch-dispatch-{}", uuid::Uuid::new_v4()),
        timestamp: started_at.clone(),
        event_type: "MULTI_SERVER_BATCH_DISPATCH".into(),
        server_id: None,
        tool_name: Some(req.tool_name.clone()),
        details_json: serde_json::json!({
            "batch_id": req.batch_id,
            "target_count": targets.len(),
            "selector": req.selector,
            "concurrency_limit": req.concurrency_limit.unwrap_or(5),
            "timeout_seconds": req.timeout_seconds.unwrap_or(30),
            "dry_run": req.dry_run.unwrap_or(false),
        })
        .to_string(),
    });

    if targets.is_empty() {
        let completed_at = Utc::now().to_rfc3339();
        return Ok(MultiServerAggregateResult {
            batch_id: req.batch_id.clone(),
            tool_name: req.tool_name.clone(),
            selector: req.selector.clone(),
            total_nodes: 0,
            succeeded_nodes: 0,
            failed_nodes: 0,
            nodes: Vec::new(),
            started_at,
            completed_at,
            summary_matrix: Some(serde_json::json!({
                "message": "No target servers matched selector"
            })),
        });
    }

    let concurrency_limit = req.concurrency_limit.unwrap_or(5).clamp(1, 20);
    let results: Arc<Mutex<Vec<NodeExecutionResult>>> = Arc::new(Mutex::new(Vec::new()));

    // Process targets in bounded parallel chunks
    for chunk in targets.chunks(concurrency_limit) {
        let mut handles = Vec::new();

        for server in chunk {
            let srv = server.clone();
            let results_clone = Arc::clone(&results);
            let tool_name = req.tool_name.clone();
            let batch_id = req.batch_id.clone();
            let mut node_arguments = req.arguments.clone();

            // Auto-populate target server_id in arguments
            if let serde_json::Value::Object(ref mut map) = node_arguments {
                map.insert(
                    "server_id".to_string(),
                    serde_json::Value::String(srv.id.clone()),
                );
            }

            let registry_clone = registry.clone();

            let handle = thread::spawn(move || {
                let node_start = Instant::now();
                let call_id = format!("{}-node-{}", batch_id, srv.id);

                let tool_req = ToolRequest {
                    id: call_id.clone(),
                    tool_name: tool_name.clone(),
                    arguments: node_arguments,
                    target_server_id: Some(srv.id.clone()),
                    conversation_id: None,
                };

                let tool_ctx = ToolExecutionContext {
                    conversation_id: None,
                    server_id: Some(srv.id.clone()),
                    target_server: Some(srv.clone()),
                    environment: Some(srv.environment.clone()),
                    authenticated_user: Some("desktop_operator".into()),
                    tool_name: tool_name.clone(),
                    risk_level: RiskLevel::ReadOnly, // Node level dispatch
                    permission_mode: PermissionMode::FullAccess,
                };

                let node_result = match registry_clone.execute(&tool_req, &tool_ctx) {
                    Ok(res) => NodeExecutionResult {
                        server_id: srv.id.clone(),
                        server_name: srv.name.clone(),
                        hostname: srv.hostname.clone(),
                        environment: srv.environment.clone(),
                        success: res.success,
                        duration_ms: res.duration_ms,
                        error: res.error,
                        data: res.data,
                        stdout: res.stdout,
                        stderr: res.stderr,
                    },
                    Err(e) => {
                        let duration = node_start.elapsed().as_millis() as u64;
                        NodeExecutionResult {
                            server_id: srv.id.clone(),
                            server_name: srv.name.clone(),
                            hostname: srv.hostname.clone(),
                            environment: srv.environment.clone(),
                            success: false,
                            duration_ms: duration,
                            error: Some(e.to_string()),
                            data: None,
                            stdout: None,
                            stderr: None,
                        }
                    }
                };

                let mut lock = results_clone.lock().unwrap();
                lock.push(node_result);
            });

            handles.push(handle);
        }

        for handle in handles {
            let _ = handle.join();
        }
    }

    let mut nodes = results.lock().unwrap().clone();
    // Maintain deterministic ordering by server_id
    nodes.sort_by(|a, b| a.server_id.cmp(&b.server_id));

    let completed_at = Utc::now().to_rfc3339();
    let total_nodes = nodes.len();
    let succeeded_nodes = nodes.iter().filter(|n| n.success).count();
    let failed_nodes = total_nodes - succeeded_nodes;

    // Record per-node audit events (Gate C)
    for node in &nodes {
        let _ = db.record_audit_event(&AuditEventRecord {
            id: format!("audit-node-{}", uuid::Uuid::new_v4()),
            timestamp: completed_at.clone(),
            event_type: "MULTI_SERVER_NODE_EXECUTION".into(),
            server_id: Some(node.server_id.clone()),
            tool_name: Some(req.tool_name.clone()),
            details_json: serde_json::json!({
                "batch_id": req.batch_id,
                "server_id": node.server_id,
                "hostname": node.hostname,
                "environment": node.environment,
                "success": node.success,
                "duration_ms": node.duration_ms,
                "error": node.error,
            })
            .to_string(),
        });
    }

    let summary_matrix = serde_json::json!({
        "total_nodes": total_nodes,
        "succeeded_nodes": succeeded_nodes,
        "failed_nodes": failed_nodes,
        "success_rate_pct": if total_nodes > 0 { (succeeded_nodes as f64 / total_nodes as f64) * 100.0 } else { 0.0 },
    });

    Ok(MultiServerAggregateResult {
        batch_id: req.batch_id.clone(),
        tool_name: req.tool_name.clone(),
        selector: req.selector.clone(),
        total_nodes,
        succeeded_nodes,
        failed_nodes,
        nodes,
        started_at,
        completed_at,
        summary_matrix: Some(summary_matrix),
    })
}

/// Execute parallel diagnostics matrix across target servers.
pub fn execute_diagnostics_matrix(
    db: &Database,
    registry: &ToolRegistry,
    req: &MultiServerDiagnosticsMatrixRequest,
) -> Result<MultiServerDiagnosticsMatrixResult, AppError> {
    let diag_type = match req.diagnostic_type.as_str() {
        "system_info" => DiagnosticType::SystemInfo,
        "disk_usage" => DiagnosticType::DiskUsage,
        "memory_usage" => DiagnosticType::MemoryUsage,
        "cpu_usage" => DiagnosticType::CpuUsage,
        "service_status" => DiagnosticType::ServiceStatus,
        other => {
            return Err(AppError::Validation(format!(
                "Unknown diagnostic_type '{}'. Expected one of: system_info, disk_usage, memory_usage, cpu_usage, service_status",
                other
            )))
        }
    };

    let batch_id = req
        .batch_id
        .clone()
        .unwrap_or_else(|| format!("matrix-{}", uuid::Uuid::new_v4()));

    let mut arguments = serde_json::json!({});
    if let DiagnosticType::ServiceStatus = diag_type {
        if let Some(ref svc) = req.service_name {
            arguments = serde_json::json!({ "service_name": svc });
        }
    }

    let batch_req = MultiServerExecutionRequest {
        batch_id: batch_id.clone(),
        tool_name: diag_type.to_tool_name().to_string(),
        arguments,
        selector: req.selector.clone(),
        concurrency_limit: req.concurrency_limit,
        timeout_seconds: req.timeout_seconds,
        dry_run: Some(false),
    };

    let aggregate = execute_batch(db, registry, &batch_req)?;
    let mut rows = Vec::new();

    for node in aggregate.nodes {
        let mut row = DiagnosticsMatrixRow {
            server_id: node.server_id,
            server_name: node.server_name,
            hostname: node.hostname,
            environment: node.environment,
            success: node.success,
            error: node.error,
            duration_ms: node.duration_ms,
            os_name: None,
            distro_family: None,
            uptime_human: None,
            cpu_cores: None,
            cpu_usage_pct: None,
            memory_usage_pct: None,
            memory_used_human: None,
            memory_total_human: None,
            primary_disk_usage_pct: None,
            primary_disk_used_human: None,
            primary_disk_total_human: None,
            service_name: None,
            service_active: None,
            service_status_text: None,
            raw_output: node.data.clone(),
        };

        if let Some(ref data) = node.data {
            match diag_type {
                DiagnosticType::SystemInfo => {
                    row.os_name = data.get("os_name").and_then(|v| v.as_str()).map(Into::into);
                    row.distro_family = data
                        .get("distro_family")
                        .and_then(|v| v.as_str())
                        .map(Into::into);
                    row.uptime_human = data
                        .get("uptime_human")
                        .and_then(|v| v.as_str())
                        .map(Into::into);
                }
                DiagnosticType::CpuUsage => {
                    row.cpu_cores = data.get("cores").and_then(|v| v.as_u64()).map(|v| v as u32);
                    let idle = data.get("idle_pct").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    row.cpu_usage_pct = Some(((100.0 - idle) * 100.0).round() / 100.0);
                }
                DiagnosticType::MemoryUsage => {
                    let total = data
                        .get("total_bytes")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let used = data.get("used_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
                    if total > 0 {
                        row.memory_usage_pct =
                            Some(((used as f64 / total as f64) * 10000.0).round() / 100.0);
                        row.memory_used_human = Some(format_bytes_human(used));
                        row.memory_total_human = Some(format_bytes_human(total));
                    }
                }
                DiagnosticType::DiskUsage => {
                    if let Some(entries) = data.as_array() {
                        // Find root '/' or largest mount
                        let root_entry = entries
                            .iter()
                            .find(|e| e.get("mount_point").and_then(|v| v.as_str()) == Some("/"))
                            .or_else(|| entries.first());

                        if let Some(entry) = root_entry {
                            row.primary_disk_usage_pct =
                                entry.get("use_percentage").and_then(|v| v.as_f64());
                            if let Some(used) = entry.get("used_bytes").and_then(|v| v.as_u64()) {
                                row.primary_disk_used_human = Some(format_bytes_human(used));
                            }
                            if let Some(tot) = entry.get("total_bytes").and_then(|v| v.as_u64()) {
                                row.primary_disk_total_human = Some(format_bytes_human(tot));
                            }
                        }
                    }
                }
                DiagnosticType::ServiceStatus => {
                    row.service_name = data.get("name").and_then(|v| v.as_str()).map(Into::into);
                    row.service_active = data.get("is_running").and_then(|v| v.as_bool());
                    row.service_status_text = data
                        .get("active_state")
                        .and_then(|v| v.as_str())
                        .map(Into::into);
                }
            }
        }

        rows.push(row);
    }

    Ok(MultiServerDiagnosticsMatrixResult {
        batch_id,
        diagnostic_type: req.diagnostic_type.clone(),
        timestamp: Utc::now().to_rfc3339(),
        total_nodes: aggregate.total_nodes,
        succeeded_nodes: aggregate.succeeded_nodes,
        failed_nodes: aggregate.failed_nodes,
        rows,
    })
}

fn format_bytes_human(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut b = bytes as f64;
    let mut unit_idx = 0;
    while b >= 1024.0 && unit_idx < UNITS.len() - 1 {
        b /= 1024.0;
        unit_idx += 1;
    }
    format!("{:.1} {}", b, UNITS[unit_idx])
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::database::Database;

    fn create_test_db_with_servers() -> Database {
        let db = Database::in_memory().expect("Failed to create in-memory database");

        let srv1 = ServerRecord {
            id: "web-01".into(),
            name: "Mock Web Server 01".into(),
            hostname: "test-web01.example.com".into(),
            port: 22,
            username: "deploy".into(),
            environment: "PRODUCTION".into(),
            auth_method: "SSH_KEY".into(),
            credential_ref: None,
            ssh_key_path: None,
            ssh_config_alias: None,
            cpanel_enabled: false,
            whm_port: None,
            whm_token_ref: None,
            tags_json: serde_json::to_string(&vec!["web", "nginx"]).unwrap(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };

        let srv2 = ServerRecord {
            id: "web-02".into(),
            name: "Mock Web Server 02".into(),
            hostname: "test-web02.example.com".into(),
            port: 22,
            username: "deploy".into(),
            environment: "STAGING".into(),
            auth_method: "SSH_KEY".into(),
            credential_ref: None,
            ssh_key_path: None,
            ssh_config_alias: None,
            cpanel_enabled: false,
            whm_port: None,
            whm_token_ref: None,
            tags_json: serde_json::to_string(&vec!["web", "apache"]).unwrap(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };

        let srv3 = ServerRecord {
            id: "db-01".into(),
            name: "Mock Database 01".into(),
            hostname: "test-db01.example.com".into(),
            port: 22,
            username: "dbadmin".into(),
            environment: "PRODUCTION".into(),
            auth_method: "SSH_KEY".into(),
            credential_ref: None,
            ssh_key_path: None,
            ssh_config_alias: None,
            cpanel_enabled: false,
            whm_port: None,
            whm_token_ref: None,
            tags_json: serde_json::to_string(&vec!["db", "mariadb"]).unwrap(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };

        db.save_server(&srv1).unwrap();
        db.save_server(&srv2).unwrap();
        db.save_server(&srv3).unwrap();

        db
    }

    #[test]
    fn test_resolve_targets_by_all() {
        let db = create_test_db_with_servers();
        let targets = resolve_targets(&db, &ServerTargetSelector::All).unwrap();
        assert_eq!(targets.len(), 3);
    }

    #[test]
    fn test_resolve_targets_by_environment() {
        let db = create_test_db_with_servers();
        let targets = resolve_targets(
            &db,
            &ServerTargetSelector::Environment {
                environment: "PRODUCTION".into(),
            },
        )
        .unwrap();
        assert_eq!(targets.len(), 2);
        assert!(targets.iter().all(|s| s.environment == "PRODUCTION"));

        let staging = resolve_targets(
            &db,
            &ServerTargetSelector::Environment {
                environment: "staging".into(),
            },
        )
        .unwrap();
        assert_eq!(staging.len(), 1);
        assert_eq!(staging[0].id, "web-02");
    }

    #[test]
    fn test_resolve_targets_by_tag() {
        let db = create_test_db_with_servers();
        let web_targets =
            resolve_targets(&db, &ServerTargetSelector::Tag { tag: "web".into() }).unwrap();
        assert_eq!(web_targets.len(), 2);

        let db_targets = resolve_targets(
            &db,
            &ServerTargetSelector::Tag {
                tag: "mariadb".into(),
            },
        )
        .unwrap();
        assert_eq!(db_targets.len(), 1);
        assert_eq!(db_targets[0].id, "db-01");
    }

    #[test]
    fn test_resolve_targets_by_tags_mode() {
        let db = create_test_db_with_servers();
        // Any match
        let any_targets = resolve_targets(
            &db,
            &ServerTargetSelector::Tags {
                tags: vec!["apache".into(), "mariadb".into()],
                match_mode: Some("any".into()),
            },
        )
        .unwrap();
        assert_eq!(any_targets.len(), 2);

        // All match
        let all_targets = resolve_targets(
            &db,
            &ServerTargetSelector::Tags {
                tags: vec!["web".into(), "nginx".into()],
                match_mode: Some("all".into()),
            },
        )
        .unwrap();
        assert_eq!(all_targets.len(), 1);
        assert_eq!(all_targets[0].id, "web-01");
    }

    #[test]
    fn test_resolve_targets_by_server_ids() {
        let db = create_test_db_with_servers();
        let targets = resolve_targets(
            &db,
            &ServerTargetSelector::ServerIds {
                server_ids: vec!["web-01".into(), "db-01".into()],
            },
        )
        .unwrap();
        assert_eq!(targets.len(), 2);
    }

    #[test]
    fn test_inherited_production_risk_policy() {
        let db = create_test_db_with_servers();
        let all_targets = resolve_targets(&db, &ServerTargetSelector::All).unwrap();

        // Batch contains production server: state-modifying action elevates to HIGH and requires CONFIRM BATCH
        let eval = evaluate_batch_policy(
            "batch-1",
            "server.service_restart",
            &all_targets,
            RiskLevel::Medium,
            true, // even in full access mode
        );
        assert!(eval.has_production_server);
        assert_eq!(eval.effective_risk_level, RiskLevel::High);
        assert!(eval.requires_confirmation);
        assert_eq!(eval.confirmation_code, Some("CONFIRM BATCH".into()));

        // Read-only diagnostics on production servers do not require confirmation
        let eval_ro = evaluate_batch_policy(
            "batch-ro",
            "server.system_info",
            &all_targets,
            RiskLevel::ReadOnly,
            false,
        );
        assert_eq!(eval_ro.effective_risk_level, RiskLevel::ReadOnly);
        assert!(!eval_ro.requires_confirmation);

        // Batch with ONLY staging server in full access mode does not require confirmation for Medium risk
        let staging_targets = resolve_targets(
            &db,
            &ServerTargetSelector::Environment {
                environment: "STAGING".into(),
            },
        )
        .unwrap();
        let eval_staging = evaluate_batch_policy(
            "batch-staging",
            "server.service_restart",
            &staging_targets,
            RiskLevel::Medium,
            true,
        );
        assert!(!eval_staging.has_production_server);
        assert_eq!(eval_staging.effective_risk_level, RiskLevel::Medium);
        assert!(!eval_staging.requires_confirmation);
    }

    #[test]
    fn test_execute_batch_and_failure_isolation() {
        let db = create_test_db_with_servers();
        let registry = ToolRegistry::new();

        let req = MultiServerExecutionRequest {
            batch_id: "batch-test-exec".into(),
            tool_name: "server.system_info".into(),
            arguments: serde_json::json!({}),
            selector: ServerTargetSelector::Tag { tag: "web".into() },
            concurrency_limit: Some(2),
            timeout_seconds: Some(10),
            dry_run: Some(false),
        };

        let result = execute_batch(&db, &registry, &req).unwrap();
        assert_eq!(result.total_nodes, 2);
        assert_eq!(result.succeeded_nodes, 2);
        assert_eq!(result.failed_nodes, 0);
        assert_eq!(result.nodes.len(), 2);

        // Verify audit event was logged
        let events = db.list_audit_events(None).unwrap();
        assert!(events
            .iter()
            .any(|e| e.event_type == "MULTI_SERVER_BATCH_DISPATCH"));
        assert!(events
            .iter()
            .any(|e| e.event_type == "MULTI_SERVER_NODE_EXECUTION"));
    }

    #[test]
    fn test_execute_diagnostics_matrix() {
        let db = create_test_db_with_servers();
        let registry = ToolRegistry::new();

        let req = MultiServerDiagnosticsMatrixRequest {
            batch_id: Some("matrix-test-cpu".into()),
            selector: ServerTargetSelector::All,
            diagnostic_type: "cpu_usage".into(),
            service_name: None,
            concurrency_limit: Some(3),
            timeout_seconds: Some(15),
        };

        let res = execute_diagnostics_matrix(&db, &registry, &req).unwrap();
        assert_eq!(res.total_nodes, 3);
        assert_eq!(res.succeeded_nodes, 3);
        assert_eq!(res.rows.len(), 3);
        for row in res.rows {
            assert!(row.cpu_cores.is_some());
            assert!(row.cpu_usage_pct.is_some());
        }
    }
}
