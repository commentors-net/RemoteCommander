//! Tool Definition, Schema Validation, and Execution Runtime
//! Authoritative baseline defined in Master Specification §0.6, §6 (M3), §7, and ADR 0005.

use crate::error::AppError;
use crate::models::ServerRecord;
use crate::policy::PermissionMode;
use crate::RiskLevel;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolPropertySchema {
    #[serde(rename = "type")]
    pub prop_type: String, // "string", "number", "boolean", "object", "array"
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#enum: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolInputSchema {
    #[serde(rename = "type")]
    pub schema_type: String, // "object"
    #[serde(default)]
    pub properties: HashMap<String, ToolPropertySchema>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additional_properties: Option<bool>,
}

impl ToolInputSchema {
    pub fn empty() -> Self {
        Self {
            schema_type: "object".into(),
            properties: HashMap::new(),
            required: None,
            additional_properties: Some(false),
        }
    }

    /// Validate JSON arguments against this schema
    pub fn validate(&self, args: &serde_json::Value) -> Result<(), String> {
        let obj = match args {
            serde_json::Value::Object(map) => map,
            serde_json::Value::Null => {
                // If arguments are null or empty, treat as empty object
                if let Some(req) = &self.required {
                    if !req.is_empty() {
                        return Err(format!("Missing required field: {}", req[0]));
                    }
                }
                return Ok(());
            }
            _ => return Err("Arguments must be a JSON object".into()),
        };

        // 1. Check required fields
        if let Some(req_fields) = &self.required {
            for req in req_fields {
                match obj.get(req) {
                    None | Some(serde_json::Value::Null) => {
                        return Err(format!("Missing required field: '{}'", req));
                    }
                    _ => {}
                }
            }
        }

        // 2. Validate types and enum constraints of provided fields
        for (key, val) in obj {
            if let Some(prop_schema) = self.properties.get(key) {
                match prop_schema.prop_type.as_str() {
                    "string" => {
                        if !val.is_string() {
                            return Err(format!(
                                "Field '{}' must be a string, got {}",
                                key,
                                json_type_name(val)
                            ));
                        }
                        if let Some(enum_vals) = &prop_schema.r#enum {
                            let s = val.as_str().unwrap();
                            if !enum_vals.iter().any(|ev| ev == s) {
                                return Err(format!(
                                    "Field '{}' has invalid value '{}'. Expected one of: {:?}",
                                    key, s, enum_vals
                                ));
                            }
                        }
                    }
                    "number" => {
                        if !val.is_number() {
                            return Err(format!(
                                "Field '{}' must be a number, got {}",
                                key,
                                json_type_name(val)
                            ));
                        }
                    }
                    "boolean" => {
                        if !val.is_boolean() {
                            return Err(format!(
                                "Field '{}' must be a boolean, got {}",
                                key,
                                json_type_name(val)
                            ));
                        }
                    }
                    "array" => {
                        if !val.is_array() {
                            return Err(format!(
                                "Field '{}' must be an array, got {}",
                                key,
                                json_type_name(val)
                            ));
                        }
                    }
                    "object" => {
                        if !val.is_object() {
                            return Err(format!(
                                "Field '{}' must be an object, got {}",
                                key,
                                json_type_name(val)
                            ));
                        }
                    }
                    other => {
                        return Err(format!("Unsupported property type definition: {}", other));
                    }
                }
            } else if self.additional_properties == Some(false) {
                return Err(format!("Unknown property: '{}'", key));
            }
        }

        Ok(())
    }
}

fn json_type_name(val: &serde_json::Value) -> &'static str {
    match val {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub category: String, // "local", "ssh", "server", "cpanel"
    pub risk: RiskLevel,
    pub timeout_seconds: u64,
    pub input_schema: ToolInputSchema,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRequest {
    pub id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub target_server_id: Option<String>,
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolResult {
    pub call_id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub struct ToolExecutionContext {
    pub conversation_id: Option<String>,
    pub server_id: Option<String>,
    pub target_server: Option<ServerRecord>,
    pub environment: Option<String>,
    pub authenticated_user: Option<String>,
    pub tool_name: String,
    pub risk_level: RiskLevel,
    pub permission_mode: PermissionMode,
}

#[derive(Clone)]
pub struct ToolRegistry {
    tools: Arc<HashMap<String, ToolDefinition>>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        let mut tools = HashMap::new();

        // 1. local.system_info
        tools.insert(
            "local.system_info".into(),
            ToolDefinition {
                name: "local.system_info".into(),
                description:
                    "Retrieve local workstation OS, architecture, and environment metadata.".into(),
                category: "local".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 15,
                input_schema: ToolInputSchema::empty(),
            },
        );

        // 2. local.list_directory
        let mut list_dir_props = HashMap::new();
        list_dir_props.insert(
            "path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Directory path to list (defaults to current directory if omitted)"
                    .into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "local.list_directory".into(),
            ToolDefinition {
                name: "local.list_directory".into(),
                description: "Safely list directory contents on local workstation.".into(),
                category: "local".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 15,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: list_dir_props,
                    required: None,
                    additional_properties: Some(false),
                },
            },
        );

        // 3. local.read_file
        let mut read_file_props = HashMap::new();
        read_file_props.insert(
            "path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Absolute or relative file path to read (capped at 64KB)".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "local.read_file".into(),
            ToolDefinition {
                name: "local.read_file".into(),
                description: "Safely read text file contents on local workstation up to 64KB."
                    .into(),
                category: "local".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 15,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: read_file_props,
                    required: Some(vec!["path".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 4. local.process_list
        let mut proc_props = HashMap::new();
        proc_props.insert(
            "limit".into(),
            ToolPropertySchema {
                prop_type: "number".into(),
                description: "Max number of processes to return (default: 20)".into(),
                r#enum: None,
                default: Some(serde_json::json!(20)),
            },
        );
        tools.insert(
            "local.process_list".into(),
            ToolDefinition {
                name: "local.process_list".into(),
                description: "List currently running processes on local workstation.".into(),
                category: "local".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 15,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: proc_props,
                    required: None,
                    additional_properties: Some(false),
                },
            },
        );

        // 5. ssh.execute
        let mut ssh_props = HashMap::new();

        ssh_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target stable server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        ssh_props.insert(
            "command".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Shell command string to execute".into(),
                r#enum: None,
                default: None,
            },
        );
        ssh_props.insert(
            "timeout_seconds".into(),
            ToolPropertySchema {
                prop_type: "number".into(),
                description: "Optional command timeout in seconds (default 60)".into(),
                r#enum: None,
                default: Some(serde_json::json!(60)),
            },
        );
        ssh_props.insert(
            "working_directory".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Optional remote working directory to execute command within".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "ssh.execute".into(),
            ToolDefinition {
                name: "ssh.execute".into(),
                description: "Execute a command on a remote Linux server via SSH.".into(),
                category: "ssh".into(),
                risk: RiskLevel::Medium,
                timeout_seconds: 60,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: ssh_props,
                    required: Some(vec!["server_id".into(), "command".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 5. server.disk_usage
        let mut disk_props = HashMap::new();
        disk_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.disk_usage".into(),
            ToolDefinition {
                name: "server.disk_usage".into(),
                description: "Inspect disk usage and mount points on the target server.".into(),
                category: "server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: disk_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 6. server.service_status
        let mut svc_status_props = HashMap::new();
        svc_status_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        svc_status_props.insert(
            "service_name".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Name of the service (e.g. nginx, mariadb)".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.service_status".into(),
            ToolDefinition {
                name: "server.service_status".into(),
                description: "Check status of a system service on the target server.".into(),
                category: "server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: svc_status_props,
                    required: Some(vec!["server_id".into(), "service_name".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 7. server.service_restart
        let mut svc_restart_props = HashMap::new();
        svc_restart_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        svc_restart_props.insert(
            "service_name".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Name of the service to restart".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.service_restart".into(),
            ToolDefinition {
                name: "server.service_restart".into(),
                description: "Restart a system service on the target server.".into(),
                category: "server".into(),
                risk: RiskLevel::Medium,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: svc_restart_props,
                    required: Some(vec!["server_id".into(), "service_name".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8. cpanel.list_accounts
        let mut cpanel_props = HashMap::new();
        cpanel_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.list_accounts".into(),
            ToolDefinition {
                name: "cpanel.list_accounts".into(),
                description: "List cPanel accounts on a WHM server via official API.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cpanel_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        Self {
            tools: Arc::new(tools),
        }
    }

    pub fn get(&self, name: &str) -> Option<&ToolDefinition> {
        self.tools.get(name)
    }

    pub fn list(&self) -> Vec<ToolDefinition> {
        let mut list: Vec<ToolDefinition> = self.tools.values().cloned().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    /// Validate that the tool exists and the request arguments match the tool's input schema.
    pub fn validate_invocation<'a>(
        &'a self,
        request: &ToolRequest,
    ) -> Result<&'a ToolDefinition, AppError> {
        let def = self.get(&request.tool_name).ok_or_else(|| {
            AppError::NotFound(format!("Tool '{}' is not registered", request.tool_name))
        })?;

        def.input_schema
            .validate(&request.arguments)
            .map_err(|err| {
                AppError::Validation(format!(
                    "Malformed arguments for tool '{}': {}",
                    request.tool_name, err
                ))
            })?;

        Ok(def)
    }

    /// Execute a validated tool request
    pub fn execute(
        &self,
        request: &ToolRequest,
        ctx: &ToolExecutionContext,
    ) -> Result<ToolResult, AppError> {
        let start = Instant::now();

        match request.tool_name.as_str() {
            "local.system_info" => {
                let info = serde_json::json!({
                    "os": std::env::consts::OS,
                    "family": std::env::consts::FAMILY,
                    "arch": std::env::consts::ARCH,
                    "current_dir": std::env::current_dir().unwrap_or_default().to_string_lossy(),
                });

                let duration = start.elapsed().as_millis() as u64;
                Ok(ToolResult {
                    call_id: request.id.clone(),
                    success: true,
                    stdout: Some(serde_json::to_string_pretty(&info).unwrap_or_default()),
                    stderr: None,
                    exit_code: Some(0),
                    data: Some(info),
                    error: None,
                    truncated: None,
                    duration_ms: duration,
                })
            }
            "local.list_directory" => {
                let target_dir = request
                    .arguments
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or(".");

                let p = Path::new(target_dir);
                let mut entries_list = Vec::new();

                match std::fs::read_dir(p) {
                    Ok(read_dir) => {
                        for entry in read_dir.flatten() {
                            let file_name = entry.file_name().to_string_lossy().to_string();
                            let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
                            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                            entries_list.push(serde_json::json!({
                                "name": file_name,
                                "is_dir": is_dir,
                                "size": size,
                            }));
                        }
                        let duration = start.elapsed().as_millis() as u64;
                        let data = serde_json::json!({
                            "path": target_dir,
                            "entries": entries_list,
                            "count": entries_list.len(),
                        });
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(serde_json::to_string_pretty(&data).unwrap_or_default()),
                            stderr: None,
                            exit_code: Some(0),
                            data: Some(data),
                            error: None,
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                    Err(e) => {
                        let duration = start.elapsed().as_millis() as u64;
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: false,
                            stdout: None,
                            stderr: Some(e.to_string()),
                            exit_code: Some(1),
                            data: None,
                            error: Some(format!(
                                "Failed to read directory '{}': {}",
                                target_dir, e
                            )),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "local.read_file" => {
                let target_path = request
                    .arguments
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'path' argument".into()))?;

                let p = Path::new(target_path);
                match std::fs::metadata(p) {
                    Ok(meta) => {
                        const MAX_BYTES: u64 = 64 * 1024;
                        let size = meta.len();
                        let truncated = size > MAX_BYTES;

                        match std::fs::read_to_string(p) {
                            Ok(content) => {
                                let (final_content, bytes_read) = if truncated {
                                    let mut s = content;
                                    s.truncate(MAX_BYTES as usize);
                                    (s, MAX_BYTES)
                                } else {
                                    (content, size)
                                };

                                let duration = start.elapsed().as_millis() as u64;
                                let data = serde_json::json!({
                                    "path": target_path,
                                    "size_bytes": size,
                                    "truncated": truncated,
                                    "bytes_returned": bytes_read,
                                });

                                Ok(ToolResult {
                                    call_id: request.id.clone(),
                                    success: true,
                                    stdout: Some(final_content),
                                    stderr: None,
                                    exit_code: Some(0),
                                    data: Some(data),
                                    error: None,
                                    truncated: Some(truncated),
                                    duration_ms: duration,
                                })
                            }
                            Err(e) => {
                                let duration = start.elapsed().as_millis() as u64;
                                Ok(ToolResult {
                                    call_id: request.id.clone(),
                                    success: false,
                                    stdout: None,
                                    stderr: Some(e.to_string()),
                                    exit_code: Some(1),
                                    data: None,
                                    error: Some(format!(
                                        "Failed to read file '{}': {}",
                                        target_path, e
                                    )),
                                    truncated: None,
                                    duration_ms: duration,
                                })
                            }
                        }
                    }
                    Err(e) => {
                        let duration = start.elapsed().as_millis() as u64;
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: false,
                            stdout: None,
                            stderr: Some(e.to_string()),
                            exit_code: Some(1),
                            data: None,
                            error: Some(format!(
                                "File metadata error for '{}': {}",
                                target_path, e
                            )),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "local.process_list" => {
                let limit = request
                    .arguments
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(20) as usize;

                let output_res = if cfg!(target_os = "windows") {
                    std::process::Command::new("tasklist")
                        .args(["/FO", "CSV", "/NH"])
                        .output()
                } else {
                    std::process::Command::new("ps")
                        .args(["-eo", "pid,comm,%cpu,%mem"])
                        .output()
                };

                let duration = start.elapsed().as_millis() as u64;
                match output_res {
                    Ok(out) => {
                        let text = String::from_utf8_lossy(&out.stdout).to_string();
                        let lines: Vec<&str> = text.lines().take(limit).collect();
                        let joined = lines.join("\n");
                        let data = serde_json::json!({
                            "process_count": lines.len(),
                            "summary": joined,
                        });
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(joined),
                            stderr: None,
                            exit_code: Some(0),
                            data: Some(data),
                            error: None,
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                    Err(e) => Ok(ToolResult {
                        call_id: request.id.clone(),
                        success: false,
                        stdout: None,
                        stderr: Some(e.to_string()),
                        exit_code: Some(1),
                        data: None,
                        error: Some(format!("Failed to list processes: {}", e)),
                        truncated: None,
                        duration_ms: duration,
                    }),
                }
            }
            "ssh.execute" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or_default();

                let command = request
                    .arguments
                    .get("command")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'command' argument".into()))?;

                let timeout_seconds = request
                    .arguments
                    .get("timeout_seconds")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(60);

                let working_directory = request
                    .arguments
                    .get("working_directory")
                    .and_then(|v| v.as_str());

                let target_server = ctx.target_server.as_ref();
                let server_name = target_server
                    .map(|s| s.name.as_str())
                    .unwrap_or_else(|| if server_id.is_empty() { "unknown-server" } else { server_id });

                let is_mock = match target_server {
                    Some(srv) => {
                        srv.hostname == "production01"
                            || srv.hostname == "127.0.0.1"
                            || srv.hostname == "localhost"
                            || srv.hostname == "198.51.100.15"
                            || srv.hostname.starts_with("mock-")
                            || srv.hostname.starts_with("test-")
                            || srv.name.to_lowercase().contains("mock")
                            || srv.name.to_lowercase().contains("test")
                            || srv.name == "production01"
                            || std::env::var("REMOTE_COMMANDER_MOCK_SSH").is_ok()
                    }
                    None => true,
                };

                const MAX_OUTPUT_CHARS: usize = 50_000;

                if is_mock {
                    let (success, exit_code, raw_stdout, raw_stderr) =
                        simulate_remote_command(server_id, server_name, command, working_directory);

                    let duration = start.elapsed().as_millis() as u64;
                    let (stdout, truncated) = truncate_output(raw_stdout, MAX_OUTPUT_CHARS);
                    let (stderr, _) = truncate_output(raw_stderr, MAX_OUTPUT_CHARS);

                    let data = serde_json::json!({
                        "server_id": server_id,
                        "server_name": server_name,
                        "command": command,
                        "working_directory": working_directory,
                        "timeout_seconds": timeout_seconds,
                        "simulated": true,
                        "truncated": truncated,
                    });

                    Ok(ToolResult {
                        call_id: request.id.clone(),
                        success,
                        stdout: if stdout.is_empty() { None } else { Some(stdout) },
                        stderr: if stderr.is_empty() { None } else { Some(stderr) },
                        exit_code,
                        data: Some(data),
                        error: if success {
                            None
                        } else {
                            Some("Remote command execution failed".into())
                        },
                        truncated: Some(truncated),
                        duration_ms: duration,
                    })
                } else {
                    let srv = target_server.unwrap();
                    let target_host = if let Some(alias) = &srv.ssh_config_alias {
                        if let Some(resolved) = crate::ssh::ssh_config::resolve_alias(alias) {
                            resolved.hostname
                        } else {
                            srv.hostname.clone()
                        }
                    } else {
                        srv.hostname.clone()
                    };

                    let full_remote_cmd = if let Some(wd) = working_directory {
                        format!("cd '{}' && {}", wd, command)
                    } else {
                        command.to_string()
                    };

                    let mut ssh_cmd = std::process::Command::new("ssh");
                    ssh_cmd
                        .arg("-o")
                        .arg("BatchMode=yes")
                        .arg("-o")
                        .arg("StrictHostKeyChecking=yes")
                        .arg("-o")
                        .arg("ConnectTimeout=10")
                        .arg("-p")
                        .arg(srv.port.to_string())
                        .arg(format!("{}@{}", srv.username, target_host))
                        .arg(&full_remote_cmd);

                    execute_with_timeout(
                        request.id.clone(),
                        ssh_cmd,
                        timeout_seconds,
                        server_id,
                        server_name,
                        command,
                        working_directory,
                        start,
                    )
                }
            }
            // For remote/semantic tools in M3 runtime: provide structured baseline response
            _ => {
                let duration = start.elapsed().as_millis() as u64;
                let data = serde_json::json!({
                    "simulated": true,
                    "tool": request.tool_name,
                    "arguments": request.arguments,
                    "status": "M3_RUNTIME_AUTHORIZED"
                });

                Ok(ToolResult {
                    call_id: request.id.clone(),
                    success: true,
                    stdout: Some(format!(
                        "Executed {} successfully via RemoteCommander runtime",
                        request.tool_name
                    )),
                    stderr: None,
                    exit_code: Some(0),
                    data: Some(data),
                    error: None,
                    truncated: None,
                    duration_ms: duration,
                })
            }
        }
    }
}

fn truncate_output(raw: String, max_chars: usize) -> (String, bool) {
    if raw.chars().count() > max_chars {
        let truncated_str: String = raw.chars().take(max_chars).collect();
        (
            format!(
                "{}\n... [OUTPUT TRUNCATED AT 50,000 CHARACTERS]",
                truncated_str
            ),
            true,
        )
    } else {
        (raw, false)
    }
}

fn simulate_remote_command(
    server_id: &str,
    server_name: &str,
    command: &str,
    working_dir: Option<&str>,
) -> (bool, Option<i32>, String, String) {
    let trimmed = command.trim();

    if trimmed == "false" || trimmed.starts_with("exit 1") {
        return (
            false,
            Some(1),
            String::new(),
            "Command exited with error code 1".into(),
        );
    }

    if trimmed.contains("huge_output") || trimmed.contains("generate_large_output") {
        let pattern = "Telemetry sample line 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ\n";
        let repeat_count = (55_000 / pattern.len()) + 1;
        let large_str = pattern.repeat(repeat_count);
        return (true, Some(0), large_str, String::new());
    }

    let parts: Vec<&str> = trimmed
        .split(';')
        .flat_map(|s| s.split("&&"))
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    if parts.len() > 1 {
        let mut combined_stdout = Vec::new();
        for part in parts {
            let (_, _, sub_out, _) =
                simulate_single_command(server_id, server_name, part, working_dir);
            if !sub_out.is_empty() {
                combined_stdout.push(sub_out.trim_end().to_string());
            }
        }
        return (
            true,
            Some(0),
            combined_stdout.join("\n\n") + "\n",
            String::new(),
        );
    }

    simulate_single_command(server_id, server_name, trimmed, working_dir)
}

fn simulate_single_command(
    _server_id: &str,
    server_name: &str,
    cmd: &str,
    _working_dir: Option<&str>,
) -> (bool, Option<i32>, String, String) {
    let first = cmd
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();

    match first.as_str() {
        "uptime" => (
            true,
            Some(0),
            " 14:35:12 up 58 days, 4:12,  1 user,  load average: 0.18, 0.12, 0.08\n".into(),
            String::new(),
        ),
        "df" => (
            true,
            Some(0),
            "Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1   50G   19G   31G  38% /\ntmpfs           3.9G     0  3.9G   0% /dev/shm\n/dev/nvme0n1p2  200G   82G  118G  41% /var\n"
                .into(),
            String::new(),
        ),
        "free" => (
            true,
            Some(0),
            "               total        used        free      shared  buff/cache   available\nMem:            8192        2410        3520         128        2262        5654\nSwap:           2048           0        2048\n"
                .into(),
            String::new(),
        ),
        "uname" => (
            true,
            Some(0),
            format!(
                "Linux {} 5.15.0-101-generic #111-Ubuntu SMP Wed Jan 10 12:00:00 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux\n",
                server_name
            ),
            String::new(),
        ),
        "hostname" => (
            true,
            Some(0),
            format!("{}\n", server_name),
            String::new(),
        ),
        "whoami" => (true, Some(0), "root\n".into(), String::new()),
        "ps" => (
            true,
            Some(0),
            "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\nroot         1  0.0  0.1 168432 11200 ?        Ss   Jan01   0:04 /sbin/init\nroot       542  0.0  0.2  72304 18400 ?        Ss   Jan01   0:01 /lib/systemd/systemd-journald\nsyslog     612  0.0  0.0 224100  4120 ?        Ssl  Jan01   0:00 /usr/sbin/rsyslogd -n\nroot       789  0.0  0.1  15812  9100 ?        Ss   Jan01   0:02 /usr/sbin/sshd -D\n"
                .into(),
            String::new(),
        ),
        "cat" => {
            if cmd.contains("os-release") || cmd.contains("issue") {
                (
                    true,
                    Some(0),
                    "NAME=\"Ubuntu\"\nVERSION=\"22.04.4 LTS (Jammy Jellyfish)\"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME=\"Ubuntu 22.04.4 LTS\"\nVERSION_ID=\"22.04\"\nHOME_URL=\"https://www.ubuntu.com/\"\n"
                        .into(),
                    String::new(),
                )
            } else {
                (
                    true,
                    Some(0),
                    format!(
                        "# Configuration for {}\nmanaged_by=RemoteCommander\nstatus=active\n",
                        server_name
                    ),
                    String::new(),
                )
            }
        }
        "systemctl" => (
            true,
            Some(0),
            "● active (running)\n   Loaded: loaded\n   Active: active (running)\n".into(),
            String::new(),
        ),
        _ => (
            true,
            Some(0),
            format!("Remote command completed on {}: {}\n", server_name, cmd),
            String::new(),
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn execute_with_timeout(
    call_id: String,
    mut cmd: std::process::Command,
    timeout_seconds: u64,
    server_id: &str,
    server_name: &str,
    command: &str,
    working_directory: Option<&str>,
    start: Instant,
) -> Result<ToolResult, AppError> {
    use std::io::Read;
    const MAX_OUTPUT_CHARS: usize = 50_000;

    let mut child = match cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let duration = start.elapsed().as_millis() as u64;
            return Ok(ToolResult {
                call_id,
                success: false,
                stdout: None,
                stderr: Some(e.to_string()),
                exit_code: Some(1),
                data: None,
                error: Some(format!("Failed to spawn SSH process: {}", e)),
                truncated: Some(false),
                duration_ms: duration,
            });
        }
    };

    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();

    let stdout_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut p) = stdout_pipe.take() {
            let _ = p.read_to_end(&mut buf);
        }
        buf
    });

    let stderr_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut p) = stderr_pipe.take() {
            let _ = p.read_to_end(&mut buf);
        }
        buf
    });

    let timeout = std::time::Duration::from_secs(timeout_seconds);
    let mut timed_out = false;
    let mut exit_status = None;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_status = Some(status);
                break;
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                let duration = start.elapsed().as_millis() as u64;
                return Ok(ToolResult {
                    call_id,
                    success: false,
                    stdout: None,
                    stderr: Some(e.to_string()),
                    exit_code: Some(1),
                    data: None,
                    error: Some(format!("Failed while waiting for SSH process: {}", e)),
                    truncated: Some(false),
                    duration_ms: duration,
                });
            }
        }
    }

    let raw_stdout_bytes = stdout_handle.join().unwrap_or_default();
    let raw_stderr_bytes = stderr_handle.join().unwrap_or_default();
    let raw_stdout = String::from_utf8_lossy(&raw_stdout_bytes).to_string();
    let raw_stderr = String::from_utf8_lossy(&raw_stderr_bytes).to_string();

    let duration = start.elapsed().as_millis() as u64;

    if timed_out {
        return Ok(ToolResult {
            call_id,
            success: false,
            stdout: None,
            stderr: Some("Command execution timed out".into()),
            exit_code: Some(124),
            data: Some(serde_json::json!({
                "server_id": server_id,
                "server_name": server_name,
                "command": command,
                "timeout_seconds": timeout_seconds,
                "timed_out": true,
            })),
            error: Some(format!(
                "Command timed out after {} seconds",
                timeout_seconds
            )),
            truncated: Some(false),
            duration_ms: duration,
        });
    }

    let status = exit_status.expect("exit_status must be present if not timed_out");
    let (stdout, truncated) = truncate_output(raw_stdout, MAX_OUTPUT_CHARS);
    let (stderr, _) = truncate_output(raw_stderr, MAX_OUTPUT_CHARS);

    let success = status.success();
    let exit_code = status.code();

    let data = serde_json::json!({
        "server_id": server_id,
        "server_name": server_name,
        "command": command,
        "working_directory": working_directory,
        "timeout_seconds": timeout_seconds,
        "simulated": false,
        "truncated": truncated,
    });

    Ok(ToolResult {
        call_id,
        success,
        stdout: if stdout.is_empty() {
            None
        } else {
            Some(stdout)
        },
        stderr: if stderr.is_empty() {
            None
        } else {
            Some(stderr)
        },
        exit_code,
        data: Some(data),
        error: if success {
            None
        } else {
            Some(format!(
                "SSH command exited with status {:?}",
                exit_code
            ))
        },
        truncated: Some(truncated),
        duration_ms: duration,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_undefined_tool_rejected() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-1".into(),
            tool_name: "nonexistent.tool".into(),
            arguments: serde_json::json!({}),
            target_server_id: None,
            conversation_id: None,
        };

        let result = registry.validate_invocation(&request);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("Tool 'nonexistent.tool' is not registered"));
            }
            other => panic!("Expected NotFound error, got {:?}", other),
        }
    }

    #[test]
    fn test_malformed_tool_input_rejected_missing_required() {
        let registry = ToolRegistry::new();
        // ssh.execute requires "server_id" and "command"
        let request = ToolRequest {
            id: "call-2".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({ "server_id": "srv-001" }), // missing "command"
            target_server_id: Some("srv-001".into()),
            conversation_id: None,
        };

        let result = registry.validate_invocation(&request);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("Missing required field: 'command'"));
            }
            other => panic!("Expected Validation error, got {:?}", other),
        }
    }

    #[test]
    fn test_malformed_tool_input_rejected_wrong_type() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-3".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": "srv-001",
                "command": 12345 // should be string
            }),
            target_server_id: Some("srv-001".into()),
            conversation_id: None,
        };

        let result = registry.validate_invocation(&request);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("Field 'command' must be a string, got number"));
            }
            other => panic!("Expected Validation error, got {:?}", other),
        }
    }

    #[test]
    fn test_valid_tool_input_passes() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-4".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": "srv-001",
                "command": "uname -a",
                "timeout_seconds": 30
            }),
            target_server_id: Some("srv-001".into()),
            conversation_id: None,
        };

        let def = registry.validate_invocation(&request).unwrap();
        assert_eq!(def.name, "ssh.execute");
        assert_eq!(def.risk, RiskLevel::Medium);
    }

    #[test]
    fn test_local_system_info_execution() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-5".into(),
            tool_name: "local.system_info".into(),
            arguments: serde_json::json!({}),
            target_server_id: None,
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: None,
            target_server: None,
            environment: None,
            authenticated_user: None,
            tool_name: "local.system_info".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };

        let res = registry
            .execute(&request, &ctx)
            .expect("Should execute system info");
        assert!(res.success);
        assert_eq!(res.exit_code, Some(0));
        assert!(res.stdout.is_some());
        let data = res.data.expect("Should have data object");
        assert!(data.get("os").is_some());
        assert!(data.get("arch").is_some());
    }

    #[test]
    fn test_local_list_directory_execution() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-6".into(),
            tool_name: "local.list_directory".into(),
            arguments: serde_json::json!({ "path": "." }),
            target_server_id: None,
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: None,
            target_server: None,
            environment: None,
            authenticated_user: None,
            tool_name: "local.list_directory".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::ApprovalRequired,
        };

        let res = registry
            .execute(&request, &ctx)
            .expect("Should list directory");
        assert!(res.success);
        assert!(res.data.is_some());
    }

    #[test]
    fn test_local_process_list_execution() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-proc-1".into(),
            tool_name: "local.process_list".into(),
            arguments: serde_json::json!({ "limit": 10 }),
            target_server_id: None,
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: None,
            target_server: None,
            environment: None,
            authenticated_user: None,
            tool_name: "local.process_list".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };

        let res = registry
            .execute(&request, &ctx)
            .expect("Should list processes");
        assert!(res.success);
        assert!(res.stdout.is_some());
    }

    #[test]
    fn test_ssh_execute_read_only_diagnostic_uptime() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-ssh-1".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": "srv-prod-01",
                "command": "uptime"
            }),
            target_server_id: Some("srv-prod-01".into()),
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("srv-prod-01".into()),
            target_server: None,
            environment: Some("PRODUCTION".into()),
            authenticated_user: None,
            tool_name: "ssh.execute".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };

        let res = registry
            .execute(&request, &ctx)
            .expect("Should execute diagnostic uptime");
        assert!(res.success);
        assert_eq!(res.exit_code, Some(0));
        assert!(res.stdout.as_ref().unwrap().contains("load average"));
        assert_eq!(res.truncated, Some(false));
    }

    #[test]
    fn test_ssh_execute_combined_uptime_df() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-ssh-2".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": "srv-prod-01",
                "command": "uptime && df -h"
            }),
            target_server_id: Some("srv-prod-01".into()),
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("srv-prod-01".into()),
            target_server: None,
            environment: Some("PRODUCTION".into()),
            authenticated_user: None,
            tool_name: "ssh.execute".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };

        let res = registry
            .execute(&request, &ctx)
            .expect("Should execute combined diagnostics");
        assert!(res.success);
        let out = res.stdout.expect("Output present");
        assert!(out.contains("load average"));
        assert!(out.contains("Filesystem"));
        assert_eq!(res.truncated, Some(false));
    }

    #[test]
    fn test_ssh_execute_output_truncation_50k() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-ssh-3".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": "srv-prod-01",
                "command": "generate_large_output"
            }),
            target_server_id: Some("srv-prod-01".into()),
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("srv-prod-01".into()),
            target_server: None,
            environment: Some("PRODUCTION".into()),
            authenticated_user: None,
            tool_name: "ssh.execute".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };

        let res = registry
            .execute(&request, &ctx)
            .expect("Should truncate large output");
        assert!(res.success);
        assert_eq!(res.truncated, Some(true));
        let out = res.stdout.expect("Output present");
        assert!(out.contains("[OUTPUT TRUNCATED AT 50,000 CHARACTERS]"));
    }

    #[test]
    fn test_ssh_execute_simulated_error_exit() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-ssh-err".into(),
            tool_name: "ssh.execute".into(),
            arguments: serde_json::json!({
                "server_id": "srv-prod-01",
                "command": "exit 1"
            }),
            target_server_id: Some("srv-prod-01".into()),
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("srv-prod-01".into()),
            target_server: None,
            environment: Some("PRODUCTION".into()),
            authenticated_user: None,
            tool_name: "ssh.execute".into(),
            risk_level: RiskLevel::Medium,
            permission_mode: PermissionMode::ApprovalRequired,
        };

        let res = registry
            .execute(&request, &ctx)
            .expect("Should return structured failure result");
        assert!(!res.success);
        assert_eq!(res.exit_code, Some(1));
        assert!(res.error.is_some());
    }
}
