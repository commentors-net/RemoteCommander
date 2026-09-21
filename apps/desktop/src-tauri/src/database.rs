//! SQLite Database and Migration Engine
//! Authoritative baseline defined in Master Specification §0.10, §3, §21, and ADR 0002.

use crate::error::AppError;
use crate::models::{
    ApprovalRecord, AuditEventRecord, ConversationRecord, KnownHostRecord, MessageRecord,
    ServerRecord, SettingRecord, ToolCallRecord,
};
use crate::secret::CredentialRefRecord;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatabaseIntegrityResult {
    pub ok: bool,
    pub integrity_check: String,
    pub foreign_key_check: Vec<String>,
    pub schema_version: i64,
    pub total_servers: i64,
    pub total_audit_events: i64,
    pub total_tool_calls: i64,
    pub total_known_hosts: i64,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatabaseVacuumResult {
    pub success: bool,
    pub message: String,
    pub vacuumed_at: String,
}

const MIGRATION_001: &str = include_str!("../migrations/001_initial_schema.sql");
const MIGRATION_002: &str = include_str!("../migrations/002_m5_ssh_transport.sql");

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &Path) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_pragmas()?;
        db.migrate()?;
        Ok(db)
    }

    pub fn in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_pragmas()?;
        db.migrate()?;
        Ok(db)
    }

    fn init_pragmas(&self) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;",
        )?;
        Ok(())
    }

    pub fn migrate(&self) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();

        // Ensure schema_migrations table exists
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                description TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
            [],
        )?;

        let current_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if current_version < 1 {
            conn.execute_batch(MIGRATION_001)?;
            conn.execute(
                "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?1, ?2, ?3)",
                params![1, "Initial Schema (Settings, Servers, Audit)", Utc::now().to_rfc3339()],
            )?;
        }

        if current_version < 2 {
            conn.execute_batch(MIGRATION_002)?;
            conn.execute(
                "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?1, ?2, ?3)",
                params![2, "SSH Transport and Known Hosts Tracking", Utc::now().to_rfc3339()],
            )?;
        }

        Ok(())
    }

    // --- Settings Repository ---

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value_json FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            let val: String = row.get(0)?;
            Ok(Some(val))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value_json: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO settings (key, value_json, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at",
            params![key, value_json, now],
        )?;
        Ok(())
    }

    pub fn list_settings(&self) -> Result<Vec<SettingRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT key, value_json, updated_at FROM settings ORDER BY key ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(SettingRecord {
                key: row.get(0)?,
                value_json: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;

        let mut settings = Vec::new();
        for s in rows {
            settings.push(s?);
        }
        Ok(settings)
    }

    // --- Server Repository ---

    pub fn save_server(&self, server: &ServerRecord) -> Result<(), AppError> {
        // Enforce non-secret invariant: Validate credential_ref is not a raw secret
        if let Some(ref cred) = server.credential_ref {
            if cred.contains("BEGIN") || cred.len() > 256 {
                return Err(AppError::SecurityViolation(
                    "Attempted to pass raw secret instead of credential reference".into(),
                ));
            }
        }

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO servers (
                id, name, hostname, port, username, environment, auth_method,
                credential_ref, ssh_key_path, ssh_config_alias, cpanel_enabled, whm_port, whm_token_ref,
                tags_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                hostname = excluded.hostname,
                port = excluded.port,
                username = excluded.username,
                environment = excluded.environment,
                auth_method = excluded.auth_method,
                credential_ref = excluded.credential_ref,
                ssh_key_path = excluded.ssh_key_path,
                ssh_config_alias = excluded.ssh_config_alias,
                cpanel_enabled = excluded.cpanel_enabled,
                whm_port = excluded.whm_port,
                whm_token_ref = excluded.whm_token_ref,
                tags_json = excluded.tags_json,
                updated_at = excluded.updated_at",
            params![
                server.id,
                server.name,
                server.hostname,
                server.port,
                server.username,
                server.environment,
                server.auth_method,
                server.credential_ref,
                server.ssh_key_path,
                server.ssh_config_alias,
                server.cpanel_enabled as i32,
                server.whm_port,
                server.whm_token_ref,
                server.tags_json,
                server.created_at,
                server.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_servers(&self) -> Result<Vec<ServerRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, hostname, port, username, environment, auth_method,
                    credential_ref, ssh_key_path, ssh_config_alias, cpanel_enabled, whm_port, whm_token_ref,
                    tags_json, created_at, updated_at
             FROM servers ORDER BY name ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            let cpanel_int: i32 = row.get(10)?;
            Ok(ServerRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                hostname: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                environment: row.get(5)?,
                auth_method: row.get(6)?,
                credential_ref: row.get(7)?,
                ssh_key_path: row.get(8)?,
                ssh_config_alias: row.get(9)?,
                cpanel_enabled: cpanel_int != 0,
                whm_port: row.get(11)?,
                whm_token_ref: row.get(12)?,
                tags_json: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })?;

        let mut servers = Vec::new();
        for s in rows {
            servers.push(s?);
        }
        Ok(servers)
    }

    pub fn delete_server(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM servers WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_server(&self, id: &str) -> Result<Option<ServerRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, hostname, port, username, environment, auth_method,
                    credential_ref, ssh_key_path, ssh_config_alias, cpanel_enabled, whm_port, whm_token_ref,
                    tags_json, created_at, updated_at
             FROM servers WHERE id = ?1 OR LOWER(name) = LOWER(?1) OR LOWER(hostname) = LOWER(?1) OR LOWER(ssh_config_alias) = LOWER(?1)",
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let cpanel_int: i32 = row.get(10)?;
            Ok(Some(ServerRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                hostname: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                environment: row.get(5)?,
                auth_method: row.get(6)?,
                credential_ref: row.get(7)?,
                ssh_key_path: row.get(8)?,
                ssh_config_alias: row.get(9)?,
                cpanel_enabled: cpanel_int != 0,
                whm_port: row.get(11)?,
                whm_token_ref: row.get(12)?,
                tags_json: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            }))
        } else {
            Ok(None)
        }
    }

    // --- Audit Events Repository ---

    pub fn record_audit_event(&self, event: &AuditEventRecord) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO audit_events (id, timestamp, event_type, server_id, tool_name, details_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                event.id,
                event.timestamp,
                event.event_type,
                event.server_id,
                event.tool_name,
                event.details_json,
            ],
        )?;
        Ok(())
    }

    pub fn list_audit_events(&self, limit: Option<u32>) -> Result<Vec<AuditEventRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let lim = limit.unwrap_or(100);
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, event_type, server_id, tool_name, details_json
             FROM audit_events ORDER BY timestamp DESC LIMIT ?1",
        )?;

        let rows = stmt.query_map(params![lim], |row| {
            Ok(AuditEventRecord {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                event_type: row.get(2)?,
                server_id: row.get(3)?,
                tool_name: row.get(4)?,
                details_json: row.get(5)?,
            })
        })?;

        let mut events = Vec::new();
        for ev in rows {
            events.push(ev?);
        }
        Ok(events)
    }

    pub fn prune_audit_events(&self, retention_days: u32) -> Result<usize, AppError> {
        if retention_days == 0 {
            return Ok(0);
        }
        let conn = self.conn.lock().unwrap();
        let cutoff = Utc::now() - chrono::Duration::days(retention_days as i64);
        let cutoff_str = cutoff.to_rfc3339();
        let deleted = conn.execute(
            "DELETE FROM audit_events WHERE timestamp < ?1",
            params![cutoff_str],
        )?;
        Ok(deleted)
    }

    pub fn export_audit_events(
        &self,
        format: &str,
        server_id: Option<&str>,
        event_type: Option<&str>,
    ) -> Result<String, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut query =
            "SELECT id, timestamp, event_type, server_id, tool_name, details_json FROM audit_events WHERE 1=1"
                .to_string();
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();

        if let Some(sid) = server_id {
            if !sid.is_empty() {
                query.push_str(" AND server_id = ?");
                params_vec.push(rusqlite::types::Value::Text(sid.to_string()));
            }
        }

        if let Some(etype) = event_type {
            if !etype.is_empty() {
                query.push_str(" AND event_type = ?");
                params_vec.push(rusqlite::types::Value::Text(etype.to_string()));
            }
        }

        query.push_str(" ORDER BY timestamp DESC");

        let mut stmt = conn.prepare(&query)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), |row| {
            Ok(AuditEventRecord {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                event_type: row.get(2)?,
                server_id: row.get(3)?,
                tool_name: row.get(4)?,
                details_json: row.get(5)?,
            })
        })?;

        let mut events = Vec::new();
        for ev in rows {
            events.push(ev?);
        }

        if format.eq_ignore_ascii_case("csv") {
            let mut csv =
                String::from("id,timestamp,event_type,server_id,tool_name,details_json\n");
            for ev in events {
                let sid = ev.server_id.as_deref().unwrap_or("");
                let tname = ev.tool_name.as_deref().unwrap_or("");
                let escaped_details = ev.details_json.replace('"', "\"\"");
                csv.push_str(&format!(
                    "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
                    ev.id.replace('"', "\"\""),
                    ev.timestamp.replace('"', "\"\""),
                    ev.event_type.replace('"', "\"\""),
                    sid.replace('"', "\"\""),
                    tname.replace('"', "\"\""),
                    escaped_details,
                ));
            }
            Ok(csv)
        } else {
            serde_json::to_string_pretty(&events).map_err(|e| {
                AppError::Database(format!("Failed to serialize audit export JSON: {}", e))
            })
        }
    }

    // --- Credential Reference Metadata Repository (NO SECRETS) ---

    pub fn save_credential_ref(&self, record: &CredentialRefRecord) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO credentials_refs (id, secret_type, label, created_at, last_used_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                label = excluded.label,
                last_used_at = excluded.last_used_at",
            params![
                record.id,
                record.secret_type,
                record.label,
                record.created_at,
                record.last_used_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_credential_refs(&self) -> Result<Vec<CredentialRefRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, secret_type, label, created_at, last_used_at
             FROM credentials_refs ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(CredentialRefRecord {
                id: row.get(0)?,
                secret_type: row.get(1)?,
                label: row.get(2)?,
                created_at: row.get(3)?,
                last_used_at: row.get(4)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn delete_credential_ref(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM credentials_refs WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_credential_last_used(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE credentials_refs SET last_used_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    // --- Tool Calls Repository ---

    pub fn save_tool_call(&self, call: &ToolCallRecord) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tool_calls (
                id, conversation_id, server_id, tool_name, arguments_json, risk_level,
                status, requested_at, approved_at, approved_by, started_at, completed_at,
                exit_code, duration_ms, stdout_summary, stderr_summary
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                approved_at = excluded.approved_at,
                approved_by = excluded.approved_by,
                started_at = excluded.started_at,
                completed_at = excluded.completed_at,
                exit_code = excluded.exit_code,
                duration_ms = excluded.duration_ms,
                stdout_summary = excluded.stdout_summary,
                stderr_summary = excluded.stderr_summary",
            params![
                call.id,
                call.conversation_id,
                call.server_id,
                call.tool_name,
                call.arguments_json,
                call.risk_level,
                call.status,
                call.requested_at,
                call.approved_at,
                call.approved_by,
                call.started_at,
                call.completed_at,
                call.exit_code,
                call.duration_ms,
                call.stdout_summary,
                call.stderr_summary,
            ],
        )?;
        Ok(())
    }

    pub fn get_tool_call(&self, id: &str) -> Result<Option<ToolCallRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, server_id, tool_name, arguments_json, risk_level,
                    status, requested_at, approved_at, approved_by, started_at, completed_at,
                    exit_code, duration_ms, stdout_summary, stderr_summary
             FROM tool_calls WHERE id = ?1",
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(ToolCallRecord {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                server_id: row.get(2)?,
                tool_name: row.get(3)?,
                arguments_json: row.get(4)?,
                risk_level: row.get(5)?,
                status: row.get(6)?,
                requested_at: row.get(7)?,
                approved_at: row.get(8)?,
                approved_by: row.get(9)?,
                started_at: row.get(10)?,
                completed_at: row.get(11)?,
                exit_code: row.get(12)?,
                duration_ms: row.get(13)?,
                stdout_summary: row.get(14)?,
                stderr_summary: row.get(15)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn update_tool_call_status(
        &self,
        id: &str,
        status: &str,
        completed_at: Option<&str>,
        exit_code: Option<i32>,
        duration_ms: Option<i64>,
        stdout_summary: Option<&str>,
        stderr_summary: Option<&str>,
    ) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tool_calls SET
                status = ?1,
                completed_at = COALESCE(?2, completed_at),
                exit_code = COALESCE(?3, exit_code),
                duration_ms = COALESCE(?4, duration_ms),
                stdout_summary = COALESCE(?5, stdout_summary),
                stderr_summary = COALESCE(?6, stderr_summary)
             WHERE id = ?7",
            params![
                status,
                completed_at,
                exit_code,
                duration_ms,
                stdout_summary,
                stderr_summary,
                id,
            ],
        )?;
        Ok(())
    }

    pub fn list_tool_calls(&self, limit: Option<u32>) -> Result<Vec<ToolCallRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let lim = limit.unwrap_or(100);
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, server_id, tool_name, arguments_json, risk_level,
                    status, requested_at, approved_at, approved_by, started_at, completed_at,
                    exit_code, duration_ms, stdout_summary, stderr_summary
             FROM tool_calls ORDER BY requested_at DESC LIMIT ?1",
        )?;

        let rows = stmt.query_map(params![lim], |row| {
            Ok(ToolCallRecord {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                server_id: row.get(2)?,
                tool_name: row.get(3)?,
                arguments_json: row.get(4)?,
                risk_level: row.get(5)?,
                status: row.get(6)?,
                requested_at: row.get(7)?,
                approved_at: row.get(8)?,
                approved_by: row.get(9)?,
                started_at: row.get(10)?,
                completed_at: row.get(11)?,
                exit_code: row.get(12)?,
                duration_ms: row.get(13)?,
                stdout_summary: row.get(14)?,
                stderr_summary: row.get(15)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    // --- Approvals Repository ---

    pub fn save_approval(&self, approval: &ApprovalRecord) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO approvals (id, tool_call_id, decision, mode, typed_acknowledgement, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                approval.id,
                approval.tool_call_id,
                approval.decision,
                approval.mode,
                approval.typed_acknowledgement,
                approval.timestamp,
            ],
        )?;
        Ok(())
    }

    pub fn list_approvals(&self, limit: Option<u32>) -> Result<Vec<ApprovalRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let lim = limit.unwrap_or(100);
        let mut stmt = conn.prepare(
            "SELECT id, tool_call_id, decision, mode, typed_acknowledgement, timestamp
             FROM approvals ORDER BY timestamp DESC LIMIT ?1",
        )?;

        let rows = stmt.query_map(params![lim], |row| {
            Ok(ApprovalRecord {
                id: row.get(0)?,
                tool_call_id: row.get(1)?,
                decision: row.get(2)?,
                mode: row.get(3)?,
                typed_acknowledgement: row.get(4)?,
                timestamp: row.get(5)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    // --- Known Hosts Repository ---

    pub fn get_known_host(
        &self,
        hostname: &str,
        port: u16,
        key_type: &str,
    ) -> Result<Option<KnownHostRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, hostname, port, key_type, public_key_base64, fingerprint_sha256,
                    first_seen_at, last_verified_at, status
             FROM known_hosts_cache
             WHERE hostname = ?1 AND port = ?2 AND key_type = ?3",
        )?;

        let mut rows = stmt.query(params![hostname, port, key_type])?;
        if let Some(row) = rows.next()? {
            Ok(Some(KnownHostRecord {
                id: row.get(0)?,
                hostname: row.get(1)?,
                port: row.get(2)?,
                key_type: row.get(3)?,
                public_key_base64: row.get(4)?,
                fingerprint_sha256: row.get(5)?,
                first_seen_at: row.get(6)?,
                last_verified_at: row.get(7)?,
                status: row.get(8)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_known_host(&self, record: &KnownHostRecord) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO known_hosts_cache (
                id, hostname, port, key_type, public_key_base64, fingerprint_sha256,
                first_seen_at, last_verified_at, status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(hostname, port, key_type) DO UPDATE SET
                public_key_base64 = excluded.public_key_base64,
                fingerprint_sha256 = excluded.fingerprint_sha256,
                last_verified_at = excluded.last_verified_at,
                status = excluded.status",
            params![
                record.id,
                record.hostname,
                record.port,
                record.key_type,
                record.public_key_base64,
                record.fingerprint_sha256,
                record.first_seen_at,
                record.last_verified_at,
                record.status,
            ],
        )?;
        Ok(())
    }

    pub fn list_known_hosts(&self) -> Result<Vec<KnownHostRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, hostname, port, key_type, public_key_base64, fingerprint_sha256,
                    first_seen_at, last_verified_at, status
             FROM known_hosts_cache ORDER BY hostname ASC, port ASC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(KnownHostRecord {
                id: row.get(0)?,
                hostname: row.get(1)?,
                port: row.get(2)?,
                key_type: row.get(3)?,
                public_key_base64: row.get(4)?,
                fingerprint_sha256: row.get(5)?,
                first_seen_at: row.get(6)?,
                last_verified_at: row.get(7)?,
                status: row.get(8)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    // --- Database Maintenance & Integrity (Milestone M17) ---

    pub fn check_integrity(&self) -> Result<DatabaseIntegrityResult, AppError> {
        let conn = self.conn.lock().unwrap();

        // 1. PRAGMA integrity_check
        let mut stmt = conn.prepare("PRAGMA integrity_check;")?;
        let mut rows = stmt.query([])?;
        let mut integrity_messages = Vec::new();
        while let Some(row) = rows.next()? {
            let msg: String = row.get(0)?;
            integrity_messages.push(msg);
        }
        let integrity_check = integrity_messages.join("; ");
        let is_ok = integrity_check.eq_ignore_ascii_case("ok");

        // 2. PRAGMA foreign_key_check
        let mut fk_stmt = conn.prepare("PRAGMA foreign_key_check;")?;
        let mut fk_rows = fk_stmt.query([])?;
        let mut fk_violations = Vec::new();
        while let Some(row) = fk_rows.next()? {
            let table: String = row.get(0)?;
            let rowid: i64 = row.get(1)?;
            let target_table: String = row.get(2)?;
            let fkid: i64 = row.get(3)?;
            fk_violations.push(format!(
                "FK violation in {table} (row {rowid}) -> {target_table} (fkid {fkid})"
            ));
        }

        // 3. Schema version
        let schema_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // 4. Record counts
        let total_servers: i64 = conn
            .query_row("SELECT COUNT(*) FROM servers", [], |row| row.get(0))
            .unwrap_or(0);
        let total_audit_events: i64 = conn
            .query_row("SELECT COUNT(*) FROM audit_events", [], |row| row.get(0))
            .unwrap_or(0);
        let total_tool_calls: i64 = conn
            .query_row("SELECT COUNT(*) FROM tool_calls", [], |row| row.get(0))
            .unwrap_or(0);
        let total_known_hosts: i64 = conn
            .query_row("SELECT COUNT(*) FROM known_hosts_cache", [], |row| {
                row.get(0)
            })
            .unwrap_or(0);

        Ok(DatabaseIntegrityResult {
            ok: is_ok && fk_violations.is_empty(),
            integrity_check,
            foreign_key_check: fk_violations,
            schema_version,
            total_servers,
            total_audit_events,
            total_tool_calls,
            total_known_hosts,
            checked_at: Utc::now().to_rfc3339(),
        })
    }

    pub fn save_conversation(&self, conv: &ConversationRecord) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, server_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                server_id = excluded.server_id,
                updated_at = excluded.updated_at",
            params![
                conv.id,
                conv.title,
                conv.server_id,
                conv.created_at,
                conv.updated_at,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn list_conversations(
        &self,
        server_id: Option<&str>,
    ) -> Result<Vec<ConversationRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut out = Vec::new();
        if let Some(sid) = server_id {
            let mut stmt = conn
                .prepare(
                    "SELECT id, title, server_id, created_at, updated_at FROM conversations \
                     WHERE server_id = ?1 OR server_id IS NULL ORDER BY updated_at DESC LIMIT 100",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows = stmt
                .query_map(params![sid], |row| {
                    Ok(ConversationRecord {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        server_id: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                })
                .map_err(|e| AppError::Database(e.to_string()))?;
            for r in rows {
                out.push(r.map_err(|e| AppError::Database(e.to_string()))?);
            }
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT id, title, server_id, created_at, updated_at FROM conversations \
                     ORDER BY updated_at DESC LIMIT 100",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(ConversationRecord {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        server_id: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                })
                .map_err(|e| AppError::Database(e.to_string()))?;
            for r in rows {
                out.push(r.map_err(|e| AppError::Database(e.to_string()))?);
            }
        }
        Ok(out)
    }

    pub fn get_conversation(&self, id: &str) -> Result<Option<ConversationRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, title, server_id, created_at, updated_at FROM conversations WHERE id = ?1",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut rows = stmt
            .query_map(params![id], |row| {
                Ok(ConversationRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    server_id: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;
        if let Some(r) = rows.next() {
            Ok(Some(r.map_err(|e| AppError::Database(e.to_string()))?))
        } else {
            Ok(None)
        }
    }

    pub fn delete_conversation(&self, id: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn save_message(&self, msg: &MessageRecord) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, tool_calls_json, tool_call_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                content = excluded.content,
                tool_calls_json = excluded.tool_calls_json",
            params![
                msg.id,
                msg.conversation_id,
                msg.role,
                msg.content,
                msg.tool_calls_json,
                msg.tool_call_id,
                msg.created_at,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<MessageRecord>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, conversation_id, role, content, tool_calls_json, tool_call_id, created_at
                 FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map(params![conversation_id], |row| {
                Ok(MessageRecord {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    tool_calls_json: row.get(4)?,
                    tool_call_id: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(out)
    }

    pub fn vacuum_database(&self) -> Result<DatabaseVacuumResult, AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("VACUUM; PRAGMA optimize;")?;
        Ok(DatabaseVacuumResult {
            success: true,
            message: "Database successfully vacuumed and query planner statistics optimized"
                .to_string(),
            vacuumed_at: Utc::now().to_rfc3339(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_database_migration() {
        let db = Database::in_memory().expect("Should initialize and migrate in-memory database");
        let settings = db.list_settings().expect("Should list settings");
        assert!(settings.is_empty());
    }

    #[test]
    fn test_settings_persistence() {
        let db = Database::in_memory().unwrap();

        // Get non-existent
        assert_eq!(db.get_setting("theme").unwrap(), None);

        // Set and get
        db.set_setting("theme", "\"dark\"").unwrap();
        assert_eq!(db.get_setting("theme").unwrap(), Some("\"dark\"".into()));

        // Update
        db.set_setting("theme", "\"system\"").unwrap();
        assert_eq!(db.get_setting("theme").unwrap(), Some("\"system\"".into()));

        let list = db.list_settings().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].key, "theme");
    }

    #[test]
    fn test_server_crud_and_security_gate_a() {
        let db = Database::in_memory().unwrap();

        let srv = ServerRecord {
            id: "srv-001".into(),
            name: "prod-web-01".into(),
            hostname: "192.168.1.50".into(),
            port: 22,
            username: "root".into(),
            environment: "PRODUCTION".into(),
            auth_method: "SSH_KEY".into(),
            credential_ref: Some("vault:ssh:prod-web-01".into()),
            ssh_key_path: Some("~/.ssh/id_ed25519".into()),
            ssh_config_alias: Some("prod-web".into()),
            cpanel_enabled: true,
            whm_port: Some(2087),
            whm_token_ref: Some("vault:whm:prod-web-01".into()),
            tags_json: "[\"web\",\"prod\"]".into(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };

        db.save_server(&srv).expect("Save server should succeed");

        let servers = db.list_servers().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "prod-web-01");
        assert_eq!(servers[0].environment, "PRODUCTION");
        assert_eq!(servers[0].ssh_config_alias, Some("prod-web".into()));
        assert!(servers[0].cpanel_enabled);

        // Test Security Gate A: Reject raw secrets in credential_ref
        let invalid_srv = ServerRecord {
            credential_ref: Some(format!("{}_TEST_RAW_PRIVATE_KEY", "BEGIN")),
            ..srv.clone()
        };
        let err = db.save_server(&invalid_srv);
        assert!(err.is_err());
        assert!(matches!(err.unwrap_err(), AppError::SecurityViolation(_)));

        // Delete server
        db.delete_server("srv-001").unwrap();
        assert!(db.list_servers().unwrap().is_empty());
    }

    #[test]
    fn test_known_hosts_cache_persistence() {
        let db = Database::in_memory().unwrap();

        let host = KnownHostRecord {
            id: "kh-001".into(),
            hostname: "192.168.1.50".into(),
            port: 22,
            key_type: "ssh-ed25519".into(),
            public_key_base64: "AAAAC3NzaC1lZDI1NTE5AAAAIExamplePublicKey==".into(),
            fingerprint_sha256: "SHA256:abcd1234efgh5678".into(),
            first_seen_at: Utc::now().to_rfc3339(),
            last_verified_at: Utc::now().to_rfc3339(),
            status: "TRUSTED".into(),
        };

        db.save_known_host(&host).expect("Should save known host");

        let fetched = db
            .get_known_host("192.168.1.50", 22, "ssh-ed25519")
            .unwrap();
        assert!(fetched.is_some());
        let fetched = fetched.unwrap();
        assert_eq!(fetched.fingerprint_sha256, "SHA256:abcd1234efgh5678");
        assert_eq!(fetched.status, "TRUSTED");

        let list = db.list_known_hosts().unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn test_audit_events_logging() {
        let db = Database::in_memory().unwrap();

        let event = AuditEventRecord {
            id: "evt-001".into(),
            timestamp: Utc::now().to_rfc3339(),
            event_type: "TOOL_INVOKED".into(),
            server_id: Some("srv-001".into()),
            tool_name: Some("server.disk_usage".into()),
            details_json: "{\"status\":\"success\"}".into(),
        };

        db.record_audit_event(&event).unwrap();
        let events = db.list_audit_events(Some(10)).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tool_name, Some("server.disk_usage".into()));
    }

    #[test]
    fn test_audit_events_pruning() {
        let db = Database::in_memory().unwrap();

        // Old event from 60 days ago
        let old_time = (Utc::now() - chrono::Duration::days(60)).to_rfc3339();
        let old_event = AuditEventRecord {
            id: "evt-old".into(),
            timestamp: old_time,
            event_type: "TOOL_INVOKED".into(),
            server_id: Some("srv-001".into()),
            tool_name: Some("server.system_info".into()),
            details_json: "{}".into(),
        };

        // Recent event from today
        let recent_time = Utc::now().to_rfc3339();
        let recent_event = AuditEventRecord {
            id: "evt-recent".into(),
            timestamp: recent_time,
            event_type: "TOOL_INVOKED".into(),
            server_id: Some("srv-001".into()),
            tool_name: Some("server.disk_usage".into()),
            details_json: "{}".into(),
        };

        db.record_audit_event(&old_event).unwrap();
        db.record_audit_event(&recent_event).unwrap();
        assert_eq!(db.list_audit_events(None).unwrap().len(), 2);

        // Pruning with 30 days retention should remove the 60-day-old event
        let pruned = db.prune_audit_events(30).unwrap();
        assert_eq!(pruned, 1);

        let remaining = db.list_audit_events(None).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "evt-recent");

        // Retention 0 means indefinite (no deletion)
        let pruned_zero = db.prune_audit_events(0).unwrap();
        assert_eq!(pruned_zero, 0);
    }

    #[test]
    fn test_export_audit_events() {
        let db = Database::in_memory().unwrap();

        let ev1 = AuditEventRecord {
            id: "evt-001".into(),
            timestamp: "2026-09-20T10:00:00Z".into(),
            event_type: "TOOL_INVOKED".into(),
            server_id: Some("srv-prod".into()),
            tool_name: Some("server.system_info".into()),
            details_json: r#"{"status":"ok"}"#.into(),
        };
        let ev2 = AuditEventRecord {
            id: "evt-002".into(),
            timestamp: "2026-09-20T10:05:00Z".into(),
            event_type: "SECURITY_VIOLATION".into(),
            server_id: Some("srv-stage".into()),
            tool_name: Some("ssh.execute".into()),
            details_json: r#"{"blocked":true}"#.into(),
        };

        db.record_audit_event(&ev1).unwrap();
        db.record_audit_event(&ev2).unwrap();

        // JSON export
        let json_out = db.export_audit_events("json", None, None).unwrap();
        assert!(json_out.contains("evt-001"));
        assert!(json_out.contains("evt-002"));

        // CSV export
        let csv_out = db.export_audit_events("csv", None, None).unwrap();
        assert!(csv_out.starts_with("id,timestamp,event_type,server_id,tool_name,details_json"));
        assert!(csv_out.contains("\"evt-001\""));
        assert!(csv_out.contains("\"TOOL_INVOKED\""));
        assert!(csv_out.contains("\"SECURITY_VIOLATION\""));

        // Filtering by server_id
        let filtered_json = db
            .export_audit_events("json", Some("srv-prod"), None)
            .unwrap();
        assert!(filtered_json.contains("evt-001"));
        assert!(!filtered_json.contains("evt-002"));
    }

    #[test]
    fn test_database_integrity_check_and_vacuum() {
        let db = Database::in_memory().unwrap();

        // Check initial integrity
        let integrity = db
            .check_integrity()
            .expect("Integrity check should succeed");
        assert!(integrity.ok);
        assert_eq!(integrity.integrity_check, "ok");
        assert!(integrity.foreign_key_check.is_empty());
        assert_eq!(integrity.schema_version, 2);
        assert_eq!(integrity.total_servers, 0);

        // Perform vacuum and query planner optimization
        let vacuum = db.vacuum_database().expect("Vacuum should succeed");
        assert!(vacuum.success);
        assert!(vacuum.message.contains("successfully vacuumed"));
    }

    #[test]
    fn test_conversation_and_messages_persistence() {
        let db = Database::in_memory().unwrap();

        let srv = ServerRecord {
            id: "srv-001".into(),
            name: "prod-web-01".into(),
            hostname: "192.168.1.50".into(),
            port: 22,
            username: "root".into(),
            environment: "PRODUCTION".into(),
            auth_method: "SSH_KEY".into(),
            credential_ref: None,
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

        let conv = ConversationRecord {
            id: "conv-100".into(),
            title: "Check WHM Security Advisor".into(),
            server_id: Some("srv-001".into()),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };

        db.save_conversation(&conv).expect("Should save conversation");

        let list = db.list_conversations(None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Check WHM Security Advisor");

        let fetched = db.get_conversation("conv-100").unwrap();
        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().id, "conv-100");

        let msg1 = MessageRecord {
            id: "msg-1".into(),
            conversation_id: "conv-100".into(),
            role: "user".into(),
            content: "Check KernelCare updates".into(),
            tool_calls_json: None,
            tool_call_id: None,
            created_at: Utc::now().to_rfc3339(),
        };

        let msg2 = MessageRecord {
            id: "msg-2".into(),
            conversation_id: "conv-100".into(),
            role: "assistant".into(),
            content: "KernelCare update is available.".into(),
            tool_calls_json: Some(r#"[{"name":"cpanel.security_advisor"}]"#.into()),
            tool_call_id: None,
            created_at: Utc::now().to_rfc3339(),
        };

        db.save_message(&msg1).unwrap();
        db.save_message(&msg2).unwrap();

        let messages = db.list_messages("conv-100").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[1].role, "assistant");

        // Delete conversation cascades to messages
        db.delete_conversation("conv-100").unwrap();
        assert!(db.list_conversations(None).unwrap().is_empty());
        assert!(db.list_messages("conv-100").unwrap().is_empty());
    }
}
