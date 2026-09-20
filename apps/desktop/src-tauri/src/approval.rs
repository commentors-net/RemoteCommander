//! Approval Manager and Privileged Action Authorization Engine
//! Authoritative baseline defined in Master Specification §0.4, §0.5, §6 (M3), §10, and ADR 0005.

use crate::database::Database;
use crate::error::AppError;
use crate::models::{ApprovalRecord, AuditEventRecord, ToolCallRecord};
use crate::policy::{evaluate_policy, PermissionMode, PolicyDecisionType};
use crate::tools::{ToolExecutionContext, ToolRegistry, ToolRequest, ToolResult};
use crate::RiskLevel;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApprovalRequest {
    pub id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub risk_level: RiskLevel,
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    pub environment: Option<String>,
    pub decision_reason: String,
    pub requires_typed_confirmation: bool,
    pub typed_confirmation_prompt: Option<String>,
    pub typed_confirmation_expected: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authenticated_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_resource: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub likely_impact: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollback_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApprovalSubmission {
    pub approval_request_id: String,
    pub approved: bool,
    pub typed_acknowledgement: Option<String>,
    pub approved_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum ToolExecutionOutcome {
    #[serde(rename = "executed")]
    Executed(ToolResult),
    #[serde(rename = "approval_required")]
    ApprovalRequired(Box<ApprovalRequest>),
    #[serde(rename = "denied")]
    Denied { reason: String },
}

pub struct StagedApproval {
    pub request: ApprovalRequest,
    pub tool_request: ToolRequest,
    pub exec_context: ToolExecutionContext,
}

pub struct ApprovalManager {
    pending: Mutex<HashMap<String, StagedApproval>>,
}

impl Default for ApprovalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ApprovalManager {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// List all currently active pending approval requests (prunes expired ones)
    pub fn list_pending(&self) -> Vec<ApprovalRequest> {
        let mut pending = self.pending.lock().unwrap();
        let now = Utc::now();

        // Prune expired
        pending.retain(|_, staged| {
            if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(&staged.request.expires_at) {
                exp.with_timezone(&Utc) > now
            } else {
                false
            }
        });

        let mut list: Vec<ApprovalRequest> = pending.values().map(|s| s.request.clone()).collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    /// Evaluates schema, target resolution, and policy, and either executes immediately or stages for user approval.
    pub fn evaluate_and_stage(
        &self,
        db: &Database,
        registry: &ToolRegistry,
        request: ToolRequest,
        mode: PermissionMode,
        authenticated_user: Option<String>,
    ) -> Result<ToolExecutionOutcome, AppError> {
        // 1. Tool registry and schema validation (M3 DoD requirement)
        let tool_def = registry.validate_invocation(&request)?;

        // 2. Resolve target server if specified
        let target_server_id = request.target_server_id.clone().or_else(|| {
            request
                .arguments
                .get("server_id")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        });
        let target_server = if let Some(ref srv_id) = target_server_id {
            db.get_server(srv_id)?
        } else {
            None
        };

        // Command heuristic extraction (if applicable, e.g. for ssh.execute)
        let command_str = request.arguments.get("command").and_then(|c| c.as_str());

        // 3. Policy evaluation strictly in native Rust (Security Gate D, ADR 0005)
        let policy_decision = evaluate_policy(
            &tool_def.category,
            &tool_def.risk,
            target_server.as_ref(),
            mode,
            command_str,
        );

        let now = Utc::now().to_rfc3339();
        let env_name = target_server.as_ref().map(|s| s.environment.clone());
        let srv_name = target_server.as_ref().map(|s| s.name.clone());

        // Record initial audit event for tool evaluation (Security Gate C)
        let eval_event = AuditEventRecord {
            id: Uuid::new_v4().to_string(),
            timestamp: now.clone(),
            event_type: "TOOL_EVALUATED".into(),
            server_id: target_server_id.clone(),
            tool_name: Some(request.tool_name.clone()),
            details_json: serde_json::to_string(&serde_json::json!({
                "decision": policy_decision.decision,
                "reason": policy_decision.reason,
                "risk_level": policy_decision.risk_level,
                "permission_mode": mode,
            }))
            .unwrap_or_default(),
        };
        db.record_audit_event(&eval_event)?;

        let exec_context = ToolExecutionContext {
            conversation_id: request.conversation_id.clone(),
            server_id: target_server_id.clone(),
            target_server: target_server.clone(),
            environment: env_name.clone(),
            authenticated_user: authenticated_user.clone(),
            tool_name: request.tool_name.clone(),
            risk_level: tool_def.risk,
            permission_mode: mode,
        };

        match policy_decision.decision {
            PolicyDecisionType::Allow => {
                // Auto-allowed by policy
                let tool_call_id = request.id.clone();
                let tool_call = ToolCallRecord {
                    id: tool_call_id.clone(),
                    conversation_id: request.conversation_id.clone(),
                    server_id: target_server_id.clone(),
                    tool_name: request.tool_name.clone(),
                    arguments_json: request.arguments.to_string(),
                    risk_level: tool_def.risk.as_str().into(),
                    status: "EXECUTING".into(),
                    requested_at: now.clone(),
                    approved_at: Some(now.clone()),
                    approved_by: Some("POLICY_ENGINE_AUTO_ALLOW".into()),
                    started_at: Some(now.clone()),
                    completed_at: None,
                    exit_code: None,
                    duration_ms: None,
                    stdout_summary: None,
                    stderr_summary: None,
                };
                db.save_tool_call(&tool_call)?;

                // Execute tool
                let tool_res = registry.execute(&request, &exec_context)?;

                let completed_at = Utc::now().to_rfc3339();
                let status_str = if tool_res.success {
                    "COMPLETED"
                } else {
                    "FAILED"
                };

                db.update_tool_call_status(
                    &tool_call_id,
                    status_str,
                    Some(&completed_at),
                    tool_res.exit_code,
                    Some(tool_res.duration_ms as i64),
                    tool_res.stdout.as_deref(),
                    tool_res.stderr.as_deref().or(tool_res.error.as_deref()),
                )?;

                // Emit execution audit event (Security Gate C)
                let exec_event = AuditEventRecord {
                    id: Uuid::new_v4().to_string(),
                    timestamp: completed_at,
                    event_type: "TOOL_EXECUTED".into(),
                    server_id: target_server_id.clone(),
                    tool_name: Some(request.tool_name.clone()),
                    details_json: serde_json::to_string(&serde_json::json!({
                        "success": tool_res.success,
                        "exit_code": tool_res.exit_code,
                        "duration_ms": tool_res.duration_ms,
                    }))
                    .unwrap_or_default(),
                };
                db.record_audit_event(&exec_event)?;

                Ok(ToolExecutionOutcome::Executed(tool_res))
            }

            PolicyDecisionType::RequireApproval | PolicyDecisionType::RequireTypedConfirmation => {
                let approval_id = Uuid::new_v4().to_string();
                let tool_call_id = request.id.clone();
                let created_dt = Utc::now();
                let expires_dt = created_dt + Duration::seconds(300); // 5-minute expiration

                let expected_confirmation = if policy_decision.requires_typed_confirmation {
                    if let Some(ref srv) = target_server {
                        Some(srv.name.clone())
                    } else {
                        Some("CONFIRM".to_string())
                    }
                } else {
                    None
                };

                let auth_user = target_server
                    .as_ref()
                    .map(|s| s.username.clone())
                    .or_else(|| authenticated_user.clone());

                let target_res = policy_decision.target_resource.or_else(|| {
                    request
                        .arguments
                        .get("path")
                        .or_else(|| request.arguments.get("file_path"))
                        .or_else(|| request.arguments.get("command"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                });

                let approval_req = ApprovalRequest {
                    id: approval_id.clone(),
                    tool_call_id: tool_call_id.clone(),
                    tool_name: request.tool_name.clone(),
                    arguments: request.arguments.clone(),
                    risk_level: tool_def.risk,
                    server_id: target_server_id.clone(),
                    server_name: srv_name,
                    environment: env_name,
                    decision_reason: policy_decision.reason,
                    requires_typed_confirmation: policy_decision.requires_typed_confirmation,
                    typed_confirmation_prompt: policy_decision.typed_confirmation_prompt,
                    typed_confirmation_expected: expected_confirmation,
                    created_at: created_dt.to_rfc3339(),
                    expires_at: expires_dt.to_rfc3339(),
                    authenticated_user: auth_user,
                    target_resource: target_res,
                    likely_impact: policy_decision.likely_impact,
                    rollback_state: policy_decision.rollback_state,
                };

                // Save pending tool call record in SQLite
                let tool_call = ToolCallRecord {
                    id: tool_call_id,
                    conversation_id: request.conversation_id.clone(),
                    server_id: target_server_id.clone(),
                    tool_name: request.tool_name.clone(),
                    arguments_json: request.arguments.to_string(),
                    risk_level: tool_def.risk.as_str().into(),
                    status: "PENDING".into(),
                    requested_at: created_dt.to_rfc3339(),
                    approved_at: None,
                    approved_by: None,
                    started_at: None,
                    completed_at: None,
                    exit_code: None,
                    duration_ms: None,
                    stdout_summary: None,
                    stderr_summary: None,
                };
                db.save_tool_call(&tool_call)?;

                // Emit approval requested audit event
                let approval_event = AuditEventRecord {
                    id: Uuid::new_v4().to_string(),
                    timestamp: created_dt.to_rfc3339(),
                    event_type: "APPROVAL_REQUESTED".into(),
                    server_id: target_server_id.clone(),
                    tool_name: Some(request.tool_name.clone()),
                    details_json: serde_json::to_string(&serde_json::json!({
                        "approval_id": approval_id,
                        "risk_level": tool_def.risk.as_str(),
                        "requires_typed_confirmation": approval_req.requires_typed_confirmation,
                    }))
                    .unwrap_or_default(),
                };
                db.record_audit_event(&approval_event)?;

                // Stage in memory
                let mut pending = self.pending.lock().unwrap();
                pending.insert(
                    approval_id,
                    StagedApproval {
                        request: approval_req.clone(),
                        tool_request: request,
                        exec_context,
                    },
                );

                Ok(ToolExecutionOutcome::ApprovalRequired(Box::new(
                    approval_req,
                )))
            }

            PolicyDecisionType::Deny => {
                let tool_call = ToolCallRecord {
                    id: request.id.clone(),
                    conversation_id: request.conversation_id.clone(),
                    server_id: target_server_id.clone(),
                    tool_name: request.tool_name.clone(),
                    arguments_json: request.arguments.to_string(),
                    risk_level: tool_def.risk.as_str().into(),
                    status: "REJECTED".into(),
                    requested_at: now.clone(),
                    approved_at: None,
                    approved_by: None,
                    started_at: None,
                    completed_at: Some(now.clone()),
                    exit_code: Some(1),
                    duration_ms: Some(0),
                    stdout_summary: None,
                    stderr_summary: Some(policy_decision.reason.clone()),
                };
                db.save_tool_call(&tool_call)?;

                let deny_event = AuditEventRecord {
                    id: Uuid::new_v4().to_string(),
                    timestamp: now,
                    event_type: "TOOL_DENIED".into(),
                    server_id: target_server_id,
                    tool_name: Some(request.tool_name),
                    details_json: serde_json::to_string(&serde_json::json!({
                        "reason": policy_decision.reason,
                    }))
                    .unwrap_or_default(),
                };
                db.record_audit_event(&deny_event)?;

                Ok(ToolExecutionOutcome::Denied {
                    reason: policy_decision.reason,
                })
            }
        }
    }

    /// Process user approval decision (Approve / Reject) with validation of expiration and typed confirmation.
    pub fn submit_approval(
        &self,
        db: &Database,
        registry: &ToolRegistry,
        submission: ApprovalSubmission,
    ) -> Result<ToolResult, AppError> {
        let staged = {
            let mut pending = self.pending.lock().unwrap();
            pending
                .remove(&submission.approval_request_id)
                .ok_or_else(|| {
                    AppError::NotFound(
                        "Pending approval request not found or already processed".into(),
                    )
                })?
        };

        let now = Utc::now();

        // 1. Check approval expiration
        if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(&staged.request.expires_at) {
            if now > exp.with_timezone(&Utc) {
                // Record expired in SQLite
                db.update_tool_call_status(
                    &staged.request.tool_call_id,
                    "CANCELLED",
                    Some(&now.to_rfc3339()),
                    Some(1),
                    Some(0),
                    None,
                    Some("Approval request expired"),
                )?;

                let expire_event = AuditEventRecord {
                    id: Uuid::new_v4().to_string(),
                    timestamp: now.to_rfc3339(),
                    event_type: "APPROVAL_EXPIRED".into(),
                    server_id: staged.request.server_id.clone(),
                    tool_name: Some(staged.request.tool_name.clone()),
                    details_json: serde_json::to_string(&serde_json::json!({
                        "approval_id": submission.approval_request_id,
                    }))
                    .unwrap_or_default(),
                };
                db.record_audit_event(&expire_event)?;

                return Err(AppError::Validation(
                    "Approval request has expired and can no longer be approved".into(),
                ));
            }
        }

        // 2. Process user rejection
        if !submission.approved {
            db.update_tool_call_status(
                &staged.request.tool_call_id,
                "REJECTED",
                Some(&now.to_rfc3339()),
                Some(1),
                Some(0),
                None,
                Some("Tool execution rejected by user"),
            )?;

            let app_rec = ApprovalRecord {
                id: Uuid::new_v4().to_string(),
                tool_call_id: staged.request.tool_call_id.clone(),
                decision: "REJECTED".into(),
                mode: "APPROVAL_REQUIRED".into(),
                typed_acknowledgement: submission.typed_acknowledgement,
                timestamp: now.to_rfc3339(),
            };
            db.save_approval(&app_rec)?;

            let reject_event = AuditEventRecord {
                id: Uuid::new_v4().to_string(),
                timestamp: now.to_rfc3339(),
                event_type: "APPROVAL_REJECTED".into(),
                server_id: staged.request.server_id,
                tool_name: Some(staged.request.tool_name),
                details_json: serde_json::to_string(&serde_json::json!({
                    "approved_by": submission.approved_by,
                }))
                .unwrap_or_default(),
            };
            db.record_audit_event(&reject_event)?;

            return Ok(ToolResult {
                call_id: staged.request.tool_call_id,
                success: false,
                stdout: None,
                stderr: Some("Action rejected by user".into()),
                exit_code: Some(1),
                data: None,
                error: Some("Tool execution was rejected by user".into()),
                truncated: None,
                duration_ms: 0,
            });
        }

        // 3. Process user approval: Verify typed confirmation if required (Security Gate D, Spec §0.5)
        if staged.request.requires_typed_confirmation {
            let expected = staged
                .request
                .typed_confirmation_expected
                .clone()
                .unwrap_or_else(|| "CONFIRM".to_string());

            let ack = submission
                .typed_acknowledgement
                .as_deref()
                .unwrap_or("")
                .trim();

            if ack != expected.as_str() {
                // Re-insert staged request so user can retry with correct confirmation
                let mut pending = self.pending.lock().unwrap();
                pending.insert(submission.approval_request_id, staged);

                return Err(AppError::SecurityViolation(format!(
                    "Typed confirmation mismatch: expected '{}', got '{}'",
                    expected, ack
                )));
            }
        }

        // 4. Record approval granted
        let app_rec = ApprovalRecord {
            id: Uuid::new_v4().to_string(),
            tool_call_id: staged.request.tool_call_id.clone(),
            decision: "APPROVED".into(),
            mode: "APPROVAL_REQUIRED".into(),
            typed_acknowledgement: submission.typed_acknowledgement,
            timestamp: now.to_rfc3339(),
        };
        db.save_approval(&app_rec)?;

        let grant_event = AuditEventRecord {
            id: Uuid::new_v4().to_string(),
            timestamp: now.to_rfc3339(),
            event_type: "APPROVAL_GRANTED".into(),
            server_id: staged.request.server_id.clone(),
            tool_name: Some(staged.request.tool_name.clone()),
            details_json: serde_json::to_string(&serde_json::json!({
                "approved_by": submission.approved_by,
            }))
            .unwrap_or_default(),
        };
        db.record_audit_event(&grant_event)?;

        // 5. Transition tool call status to EXECUTING
        db.update_tool_call_status(
            &staged.request.tool_call_id,
            "EXECUTING",
            None,
            None,
            None,
            None,
            None,
        )?;

        // 6. Execute approved tool
        let tool_res = registry.execute(&staged.tool_request, &staged.exec_context)?;

        let completed_at = Utc::now().to_rfc3339();
        let status_str = if tool_res.success {
            "COMPLETED"
        } else {
            "FAILED"
        };

        db.update_tool_call_status(
            &staged.request.tool_call_id,
            status_str,
            Some(&completed_at),
            tool_res.exit_code,
            Some(tool_res.duration_ms as i64),
            tool_res.stdout.as_deref(),
            tool_res.stderr.as_deref().or(tool_res.error.as_deref()),
        )?;

        // 7. Emit execution audit event (Security Gate C)
        let exec_event = AuditEventRecord {
            id: Uuid::new_v4().to_string(),
            timestamp: completed_at,
            event_type: "TOOL_EXECUTED".into(),
            server_id: staged.request.server_id,
            tool_name: Some(staged.request.tool_name),
            details_json: serde_json::to_string(&serde_json::json!({
                "success": tool_res.success,
                "exit_code": tool_res.exit_code,
                "duration_ms": tool_res.duration_ms,
            }))
            .unwrap_or_default(),
        };
        db.record_audit_event(&exec_event)?;

        Ok(tool_res)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ServerRecord;

    fn setup_test_server(db: &Database, name: &str, env: &str) -> ServerRecord {
        let srv = ServerRecord {
            id: format!("srv-{}", name),
            name: name.into(),
            hostname: "127.0.0.1".into(),
            port: 22,
            username: "root".into(),
            environment: env.into(),
            auth_method: "SSH_KEY".into(),
            credential_ref: Some("opaque:ref".into()),
            ssh_key_path: None,
            ssh_config_alias: None,
            cpanel_enabled: false,
            whm_port: None,
            whm_token_ref: None,
            tags_json: "[]".into(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };
        db.save_server(&srv).unwrap();
        srv
    }

    #[test]
    fn test_read_only_tool_auto_executes_and_audits() {
        let db = Database::in_memory().unwrap();
        let registry = ToolRegistry::new();
        let manager = ApprovalManager::new();

        let req = ToolRequest {
            id: "req-ro-1".into(),
            tool_name: "local.system_info".into(),
            arguments: serde_json::json!({}),
            target_server_id: None,
            conversation_id: None,
        };

        let outcome = manager
            .evaluate_and_stage(&db, &registry, req, PermissionMode::ApprovalRequired, None)
            .expect("Should evaluate and execute");

        match outcome {
            ToolExecutionOutcome::Executed(res) => {
                assert!(res.success);
                assert_eq!(res.call_id, "req-ro-1");
            }
            _ => panic!("Expected immediate execution for read-only tool"),
        }

        // Verify tool call record saved in SQLite
        let tool_call = db
            .get_tool_call("req-ro-1")
            .unwrap()
            .expect("Record exists");
        assert_eq!(tool_call.status, "COMPLETED");

        // Verify audit events emitted (TOOL_EVALUATED and TOOL_EXECUTED)
        let audits = db.list_audit_events(None).unwrap();
        assert!(audits.iter().any(|a| a.event_type == "TOOL_EVALUATED"));
        assert!(audits.iter().any(|a| a.event_type == "TOOL_EXECUTED"));
    }

    #[test]
    fn test_approval_flow_and_rejection() {
        let db = Database::in_memory().unwrap();
        let srv = setup_test_server(&db, "test-server", "PRODUCTION");
        let registry = ToolRegistry::new();
        let manager = ApprovalManager::new();

        let req = ToolRequest {
            id: "req-app-1".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": srv.id,
                "command": "systemctl restart nginx"
            }),
            target_server_id: Some(srv.id.clone()),
            conversation_id: None,
        };

        // ApprovalRequired mode requires approval for state-changing tools
        let outcome = manager
            .evaluate_and_stage(&db, &registry, req, PermissionMode::ApprovalRequired, None)
            .unwrap();

        let approval_req = match outcome {
            ToolExecutionOutcome::ApprovalRequired(ar) => *ar,
            _ => panic!("Expected ApprovalRequired"),
        };

        assert_eq!(approval_req.tool_name, "ssh.execute");
        assert_eq!(manager.list_pending().len(), 1);

        // User submits REJECTION
        let sub = ApprovalSubmission {
            approval_request_id: approval_req.id.clone(),
            approved: false,
            typed_acknowledgement: None,
            approved_by: "test_user".into(),
        };

        let res = manager.submit_approval(&db, &registry, sub).unwrap();
        assert!(!res.success);
        assert!(res.error.unwrap().contains("rejected"));

        // Verify status in DB is REJECTED
        let tc = db.get_tool_call("req-app-1").unwrap().unwrap();
        assert_eq!(tc.status, "REJECTED");

        // Verify audit event emitted
        let audits = db.list_audit_events(None).unwrap();
        assert!(audits.iter().any(|a| a.event_type == "APPROVAL_REJECTED"));
        assert!(manager.list_pending().is_empty());
    }

    #[test]
    fn test_typed_confirmation_validation() {
        let db = Database::in_memory().unwrap();
        let srv = setup_test_server(&db, "prod-db-server", "PRODUCTION");
        let registry = ToolRegistry::new();
        let manager = ApprovalManager::new();

        // Destructive command triggering heuristic -> requires typed confirmation of server name
        let req = ToolRequest {
            id: "req-crit-1".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": srv.id,
                "command": "rm -rf /"
            }),
            target_server_id: Some(srv.id.clone()),
            conversation_id: None,
        };

        let outcome = manager
            .evaluate_and_stage(&db, &registry, req, PermissionMode::FullAccess, None)
            .unwrap();

        let approval_req = match outcome {
            ToolExecutionOutcome::ApprovalRequired(ar) => *ar,
            _ => panic!("Expected ApprovalRequired for destructive command"),
        };

        assert!(approval_req.requires_typed_confirmation);
        assert_eq!(
            approval_req.typed_confirmation_expected,
            Some("prod-db-server".into())
        );

        // 1. Submit with WRONG typed confirmation -> Must fail
        let wrong_sub = ApprovalSubmission {
            approval_request_id: approval_req.id.clone(),
            approved: true,
            typed_acknowledgement: Some("wrong-name".into()),
            approved_by: "admin".into(),
        };
        let err = manager.submit_approval(&db, &registry, wrong_sub);
        assert!(err.is_err());
        match err.unwrap_err() {
            AppError::SecurityViolation(msg) => {
                assert!(msg.contains("Typed confirmation mismatch"));
            }
            other => panic!("Expected SecurityViolation, got {:?}", other),
        }

        // 2. Submit with CORRECT typed confirmation -> Must succeed
        let correct_sub = ApprovalSubmission {
            approval_request_id: approval_req.id.clone(),
            approved: true,
            typed_acknowledgement: Some("prod-db-server".into()),
            approved_by: "admin".into(),
        };
        let res = manager
            .submit_approval(&db, &registry, correct_sub)
            .unwrap();
        assert!(res.success);

        let tc = db.get_tool_call("req-crit-1").unwrap().unwrap();
        assert_eq!(tc.status, "COMPLETED");

        let audits = db.list_audit_events(None).unwrap();
        assert!(audits.iter().any(|a| a.event_type == "APPROVAL_GRANTED"));
        assert!(audits.iter().any(|a| a.event_type == "TOOL_EXECUTED"));
    }

    #[test]
    fn test_approval_expiration() {
        let db = Database::in_memory().unwrap();
        let srv = setup_test_server(&db, "test-server", "PRODUCTION");
        let registry = ToolRegistry::new();
        let manager = ApprovalManager::new();

        let req = ToolRequest {
            id: "req-exp-1".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": srv.id,
                "command": "systemctl restart nginx"
            }),
            target_server_id: Some(srv.id.clone()),
            conversation_id: None,
        };

        let outcome = manager
            .evaluate_and_stage(&db, &registry, req, PermissionMode::ApprovalRequired, None)
            .unwrap();

        let approval_req = match outcome {
            ToolExecutionOutcome::ApprovalRequired(ar) => *ar,
            _ => panic!("Expected ApprovalRequired"),
        };

        // Manually mutate expiration time to the past
        {
            let mut pending = manager.pending.lock().unwrap();
            let staged = pending.get_mut(&approval_req.id).unwrap();
            staged.request.expires_at = (Utc::now() - Duration::seconds(10)).to_rfc3339();
        }

        // Attempt submission -> Must reject due to expiration
        let sub = ApprovalSubmission {
            approval_request_id: approval_req.id,
            approved: true,
            typed_acknowledgement: None,
            approved_by: "admin".into(),
        };

        let err = manager.submit_approval(&db, &registry, sub);
        assert!(err.is_err());
        match err.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("expired"));
            }
            other => panic!("Expected Validation error for expiration, got {:?}", other),
        }

        // Verify audit event emitted
        let audits = db.list_audit_events(None).unwrap();
        assert!(audits.iter().any(|a| a.event_type == "APPROVAL_EXPIRED"));
    }

    #[test]
    fn test_definition_of_done_synthetic_vertical_slice() {
        // Master Spec M3 DoD:
        // "A synthetic tool request can pass through schema validation -> policy -> approval -> executor -> result -> audit without any AI provider involved."
        let db = Database::in_memory().unwrap();
        let srv = setup_test_server(&db, "production-web", "PRODUCTION");
        let registry = ToolRegistry::new();
        let manager = ApprovalManager::new();

        let tool_req = ToolRequest {
            id: "m3-dod-call-1".into(),
            tool_name: "server.service_restart".into(),
            arguments: serde_json::json!({
                "server_id": srv.id,
                "service_name": "httpd"
            }),
            target_server_id: Some(srv.id.clone()),
            conversation_id: None,
        };

        // 1. Schema validation -> Policy evaluation -> Requires Approval
        let stage_res = manager
            .evaluate_and_stage(
                &db,
                &registry,
                tool_req,
                PermissionMode::ApprovalRequired,
                None,
            )
            .expect("Schema validation and policy check should succeed");

        let approval_req = match stage_res {
            ToolExecutionOutcome::ApprovalRequired(ar) => *ar,
            other => panic!("Expected ApprovalRequired, got {:?}", other),
        };
        assert_eq!(approval_req.tool_call_id, "m3-dod-call-1");

        // 2. User submits approval
        let sub = ApprovalSubmission {
            approval_request_id: approval_req.id,
            approved: true,
            typed_acknowledgement: None,
            approved_by: "secops_user".into(),
        };

        let exec_res = manager
            .submit_approval(&db, &registry, sub)
            .expect("Approval submission should succeed");

        // 3. Executor produces result
        assert!(exec_res.success);
        assert_eq!(exec_res.call_id, "m3-dod-call-1");

        // 4. Result and audit persisted
        let stored_call = db.get_tool_call("m3-dod-call-1").unwrap().unwrap();
        assert_eq!(stored_call.status, "COMPLETED");

        let approvals = db.list_approvals(None).unwrap();
        assert_eq!(approvals.len(), 1);
        assert_eq!(approvals[0].decision, "APPROVED");

        let audits = db.list_audit_events(None).unwrap();
        assert!(audits.iter().any(|a| a.event_type == "TOOL_EVALUATED"));
        assert!(audits.iter().any(|a| a.event_type == "APPROVAL_REQUESTED"));
        assert!(audits.iter().any(|a| a.event_type == "APPROVAL_GRANTED"));
        assert!(audits.iter().any(|a| a.event_type == "TOOL_EXECUTED"));
    }

    #[test]
    fn test_ssh_execute_read_only_diagnostic_auto_executes_on_production() {
        let db = Database::in_memory().unwrap();
        let srv = setup_test_server(&db, "production01", "PRODUCTION");
        let registry = ToolRegistry::new();
        let manager = ApprovalManager::new();

        let req = ToolRequest {
            id: "req-diag-prod-1".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": srv.id,
                "command": "uptime && df -h"
            }),
            target_server_id: Some(srv.id.clone()),
            conversation_id: None,
        };

        // ApprovalRequired mode: read-only diagnostics evaluate as ReadOnly and are auto-allowed!
        let outcome = manager
            .evaluate_and_stage(&db, &registry, req, PermissionMode::ApprovalRequired, None)
            .expect("Should evaluate and execute without approval");

        match outcome {
            ToolExecutionOutcome::Executed(res) => {
                assert!(res.success);
                assert_eq!(res.call_id, "req-diag-prod-1");
                let out = res.stdout.expect("Output present");
                assert!(out.contains("load average"));
                assert!(out.contains("Filesystem"));
                assert_eq!(res.truncated, Some(false));
            }
            other => panic!("Expected Executed outcome, got {:?}", other),
        }

        // Verify tool call record saved in SQLite as COMPLETED
        let tool_call = db.get_tool_call("req-diag-prod-1").unwrap().unwrap();
        assert_eq!(tool_call.status, "COMPLETED");
        assert_eq!(
            tool_call.approved_by,
            Some("POLICY_ENGINE_AUTO_ALLOW".into())
        );
    }
}
