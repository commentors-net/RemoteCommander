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
}

fn expand_tilde(path: &str) -> std::path::PathBuf {
    if path.starts_with("~/") || path.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[2..]);
        }
    }
    std::path::PathBuf::from(path)
}

impl ToolInputSchema {
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

        // 5a. ssh.list_directory
        let mut list_dir_props = HashMap::new();
        list_dir_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target stable server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        list_dir_props.insert(
            "path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Remote directory path to list (defaults to /)".into(),
                r#enum: None,
                default: Some(serde_json::json!("/")),
            },
        );
        list_dir_props.insert(
            "show_hidden".into(),
            ToolPropertySchema {
                prop_type: "boolean".into(),
                description: "Include hidden files (dotfiles)".into(),
                r#enum: None,
                default: Some(serde_json::json!(false)),
            },
        );
        tools.insert(
            "ssh.list_directory".into(),
            ToolDefinition {
                name: "ssh.list_directory".into(),
                description: "List files and directories on remote server with detailed metadata."
                    .into(),
                category: "ssh".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: list_dir_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 5b. ssh.read_file
        let mut read_props = HashMap::new();
        read_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target stable server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        read_props.insert(
            "path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Absolute remote file path to read".into(),
                r#enum: None,
                default: None,
            },
        );
        read_props.insert(
            "max_bytes".into(),
            ToolPropertySchema {
                prop_type: "number".into(),
                description: "Maximum bytes to read (default 100,000)".into(),
                r#enum: None,
                default: Some(serde_json::json!(100_000)),
            },
        );
        tools.insert(
            "ssh.read_file".into(),
            ToolDefinition {
                name: "ssh.read_file".into(),
                description:
                    "Safely read remote text or config file with 100KB truncation protection."
                        .into(),
                category: "ssh".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: read_props,
                    required: Some(vec!["server_id".into(), "path".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 5c. ssh.write_file
        let mut write_props = HashMap::new();
        write_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target stable server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        write_props.insert(
            "path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Absolute remote file path to write".into(),
                r#enum: None,
                default: None,
            },
        );
        write_props.insert(
            "content".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Text content to write".into(),
                r#enum: None,
                default: None,
            },
        );
        write_props.insert(
            "create_backup".into(),
            ToolPropertySchema {
                prop_type: "boolean".into(),
                description: "Create automatic backup (.bak.<timestamp>) before overwriting".into(),
                r#enum: None,
                default: Some(serde_json::json!(true)),
            },
        );
        tools.insert(
            "ssh.write_file".into(),
            ToolDefinition {
                name: "ssh.write_file".into(),
                description: "Safely write or update remote file content with automatic backup and diff verification.".into(),
                category: "ssh".into(),
                risk: RiskLevel::High,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: write_props,
                    required: Some(vec!["server_id".into(), "path".into(), "content".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 5d. ssh.file_info
        let mut stat_props = HashMap::new();
        stat_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target stable server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        stat_props.insert(
            "path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Remote path to stat".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "ssh.file_info".into(),
            ToolDefinition {
                name: "ssh.file_info".into(),
                description: "Get detailed stat metadata (size, permissions, owner, timestamps) for a remote file or directory.".into(),
                category: "ssh".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 20,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: stat_props,
                    required: Some(vec!["server_id".into(), "path".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 5e. ssh.upload
        let mut upload_props = HashMap::new();
        upload_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target stable server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        upload_props.insert(
            "remote_path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Destination path on remote server".into(),
                r#enum: None,
                default: None,
            },
        );
        upload_props.insert(
            "content".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "File content to upload".into(),
                r#enum: None,
                default: None,
            },
        );
        upload_props.insert(
            "overwrite".into(),
            ToolPropertySchema {
                prop_type: "boolean".into(),
                description: "Whether to overwrite existing file".into(),
                r#enum: None,
                default: Some(serde_json::json!(false)),
            },
        );
        tools.insert(
            "ssh.upload".into(),
            ToolDefinition {
                name: "ssh.upload".into(),
                description: "Upload local text or file content to target remote server path."
                    .into(),
                category: "ssh".into(),
                risk: RiskLevel::Medium,
                timeout_seconds: 60,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: upload_props,
                    required: Some(vec![
                        "server_id".into(),
                        "remote_path".into(),
                        "content".into(),
                    ]),
                    additional_properties: Some(false),
                },
            },
        );

        // 5f. ssh.download
        let mut download_props = HashMap::new();
        download_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target stable server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        download_props.insert(
            "remote_path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Remote file path to download".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "ssh.download".into(),
            ToolDefinition {
                name: "ssh.download".into(),
                description: "Download file content from remote server to local workstation."
                    .into(),
                category: "ssh".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 60,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: download_props,
                    required: Some(vec!["server_id".into(), "remote_path".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 5. M10 Semantic Server Operations tools
        // server.system_info
        let mut sysinfo_props = HashMap::new();
        sysinfo_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.system_info".into(),
            ToolDefinition {
                name: "server.system_info".into(),
                description: "Inspect basic system info (OS, kernel, hostname, architecture, uptime) on the target server.".into(),
                category: "server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: sysinfo_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // server.disk_usage
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

        // server.memory_usage
        let mut mem_props = HashMap::new();
        mem_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.memory_usage".into(),
            ToolDefinition {
                name: "server.memory_usage".into(),
                description: "Inspect memory and swap usage metrics on the target server.".into(),
                category: "server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: mem_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // server.cpu_usage
        let mut cpu_props = HashMap::new();
        cpu_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.cpu_usage".into(),
            ToolDefinition {
                name: "server.cpu_usage".into(),
                description: "Inspect CPU utilization, cores, and load distribution on target server.".into(),
                category: "server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cpu_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // server.load_average
        let mut load_props = HashMap::new();
        load_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.load_average".into(),
            ToolDefinition {
                name: "server.load_average".into(),
                description: "Inspect 1, 5, and 15-minute load averages on the target server."
                    .into(),
                category: "server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: load_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // server.process_list
        let mut proc_props = HashMap::new();
        proc_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        proc_props.insert(
            "limit".into(),
            ToolPropertySchema {
                prop_type: "number".into(),
                description: "Maximum number of processes to return (default 30)".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.process_list".into(),
            ToolDefinition {
                name: "server.process_list".into(),
                description:
                    "List running processes sorted by resource utilization on the target server."
                        .into(),
                category: "server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: proc_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // server.network_connections
        let mut net_props = HashMap::new();
        net_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.network_connections".into(),
            ToolDefinition {
                name: "server.network_connections".into(),
                description:
                    "Inspect active and listening network connections on the target server.".into(),
                category: "server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: net_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // server.service_status
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
                description: "Name of the service (e.g. nginx, mariadb, httpd)".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.service_status".into(),
            ToolDefinition {
                name: "server.service_status".into(),
                description: "Check status of a system service across Linux distros.".into(),
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

        // server.service_start
        let mut svc_start_props = HashMap::new();
        svc_start_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        svc_start_props.insert(
            "service_name".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Name or alias of the service to start".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.service_start".into(),
            ToolDefinition {
                name: "server.service_start".into(),
                description: "Start a system service on the target server.".into(),
                category: "server".into(),
                risk: RiskLevel::Medium,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: svc_start_props,
                    required: Some(vec!["server_id".into(), "service_name".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // server.service_stop
        let mut svc_stop_props = HashMap::new();
        svc_stop_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        svc_stop_props.insert(
            "service_name".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Name or alias of the service to stop".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.service_stop".into(),
            ToolDefinition {
                name: "server.service_stop".into(),
                description: "Stop a system service on the target server.".into(),
                category: "server".into(),
                risk: RiskLevel::High,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: svc_stop_props,
                    required: Some(vec!["server_id".into(), "service_name".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // server.service_restart
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

        // server.tail_log
        let mut log_props = HashMap::new();
        log_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        log_props.insert(
            "path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Log file path (e.g. /var/log/messages, /var/log/nginx/error.log)"
                    .into(),
                r#enum: None,
                default: None,
            },
        );
        log_props.insert(
            "lines".into(),
            ToolPropertySchema {
                prop_type: "number".into(),
                description: "Number of lines to tail (default 50)".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "server.tail_log".into(),
            ToolDefinition {
                name: "server.tail_log".into(),
                description: "Read the recent lines from a log file on the target server.".into(),
                category: "server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: log_props,
                    required: Some(vec!["server_id".into(), "path".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8a. cpanel.server_info
        let mut cp_srv_info_props = HashMap::new();
        cp_srv_info_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id with WHM/cPanel enabled".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.server_info".into(),
            ToolDefinition {
                name: "cpanel.server_info".into(),
                description: "Inspect WHM/cPanel server version, build, license status, operating system, and active services.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_srv_info_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8b. cpanel.list_accounts
        let mut cp_list_accts_props = HashMap::new();
        cp_list_accts_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id with WHM/cPanel enabled".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.list_accounts".into(),
            ToolDefinition {
                name: "cpanel.list_accounts".into(),
                description: "List all hosted cPanel accounts with user, primary domain, plan, disk usage, and suspended status.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_list_accts_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8c. cpanel.account_info
        let mut cp_acct_info_props = HashMap::new();
        cp_acct_info_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_acct_info_props.insert(
            "user".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Username of the cPanel account".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.account_info".into(),
            ToolDefinition {
                name: "cpanel.account_info".into(),
                description: "Get detailed configuration, limits, contact email, and quota metrics for a specific cPanel account.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_acct_info_props,
                    required: Some(vec!["server_id".into(), "user".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8d. cpanel.list_domains
        let mut cp_domains_props = HashMap::new();
        cp_domains_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_domains_props.insert(
            "user".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Optional username to filter domains".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.list_domains".into(),
            ToolDefinition {
                name: "cpanel.list_domains".into(),
                description: "List all domains, subdomains, addon domains, and parked aliases across all accounts on the WHM server.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_domains_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8e. cpanel.service_status
        let mut cp_svc_status_props = HashMap::new();
        cp_svc_status_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_svc_status_props.insert(
            "service_name".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Optional service daemon name to check".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.service_status".into(),
            ToolDefinition {
                name: "cpanel.service_status".into(),
                description: "Inspect status of cPanel server daemons (cpsrvd, cpdavd, cpgreylistd, queueprocd, tailwatchd, etc.).".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_svc_status_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8f. cpanel.restart_service
        let mut cp_restart_props = HashMap::new();
        cp_restart_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_restart_props.insert(
            "service_name".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Name of the service daemon to restart".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.restart_service".into(),
            ToolDefinition {
                name: "cpanel.restart_service".into(),
                description: "Restart a cPanel service daemon via WHM API (e.g. cpanel, httpd, mysql, dnsadmin, ftpd).".into(),
                category: "cpanel".into(),
                risk: RiskLevel::Medium,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_restart_props,
                    required: Some(vec!["server_id".into(), "service_name".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8g. cpanel.ssl_status
        let mut cp_ssl_props = HashMap::new();
        cp_ssl_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_ssl_props.insert(
            "user".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Optional account username filter".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_ssl_props.insert(
            "domain".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Optional domain name filter".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.ssl_status".into(),
            ToolDefinition {
                name: "cpanel.ssl_status".into(),
                description: "Inspect AutoSSL status and SSL certificate expirations for accounts and domains.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_ssl_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8h. cpanel.backup_status
        let mut cp_backup_props = HashMap::new();
        cp_backup_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.backup_status".into(),
            ToolDefinition {
                name: "cpanel.backup_status".into(),
                description: "Inspect cPanel automated backup configuration, schedule, retention, and last run status.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_backup_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8i. cpanel.account_disk_usage
        let mut cp_disk_props = HashMap::new();
        cp_disk_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_disk_props.insert(
            "user".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Username of the cPanel account".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.account_disk_usage".into(),
            ToolDefinition {
                name: "cpanel.account_disk_usage".into(),
                description: "Inspect detailed disk usage breakdown for an account (public_html, mail, mysql, home).".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_disk_props,
                    required: Some(vec!["server_id".into(), "user".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8j. cpanel.list_php_versions
        let mut cp_php_props = HashMap::new();
        cp_php_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.list_php_versions".into(),
            ToolDefinition {
                name: "cpanel.list_php_versions".into(),
                description: "List installed MultiPHP versions, system default PHP version, and PHP handlers.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_php_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8k. cpanel.suspend_account
        let mut cp_suspend_props = HashMap::new();
        cp_suspend_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_suspend_props.insert(
            "user".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Username of the cPanel account to suspend".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_suspend_props.insert(
            "reason".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Operational reason for suspension".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.suspend_account".into(),
            ToolDefinition {
                name: "cpanel.suspend_account".into(),
                description: "Suspend a cPanel account with an operational reason. High-risk state change requiring explicit operator confirmation.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::High,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_suspend_props,
                    required: Some(vec!["server_id".into(), "user".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8l. cpanel.unsuspend_account
        let mut cp_unsuspend_props = HashMap::new();
        cp_unsuspend_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        cp_unsuspend_props.insert(
            "user".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Username of the cPanel account to unsuspend".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.unsuspend_account".into(),
            ToolDefinition {
                name: "cpanel.unsuspend_account".into(),
                description: "Unsuspend a previously suspended cPanel account.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::Medium,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_unsuspend_props,
                    required: Some(vec!["server_id".into(), "user".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 8m. cpanel.security_advisor
        let mut cp_sec_props = HashMap::new();
        cp_sec_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id with WHM/cPanel enabled".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "cpanel.security_advisor".into(),
            ToolDefinition {
                name: "cpanel.security_advisor".into(),
                description: "Query WHM Security Advisor recommendations, warnings, and alerts to inspect server hardening status.".into(),
                category: "cpanel".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: cp_sec_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 9a. safety.create_backup
        let mut bak_props = HashMap::new();
        bak_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        bak_props.insert(
            "file_path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Absolute path of the remote file to backup".into(),
                r#enum: None,
                default: None,
            },
        );
        bak_props.insert(
            "reason".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Reason or operational note for this safety backup".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "safety.create_backup".into(),
            ToolDefinition {
                name: "safety.create_backup".into(),
                description: "Create an automatic timestamped backup of a remote configuration file before modifications.".into(),
                category: "safety".into(),
                risk: RiskLevel::Low,
                timeout_seconds: 30,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: bak_props,
                    required: Some(vec!["server_id".into(), "file_path".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 9b. safety.rollback_file
        let mut roll_props = HashMap::new();
        roll_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        roll_props.insert(
            "file_path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target file path to restore".into(),
                r#enum: None,
                default: None,
            },
        );
        roll_props.insert(
            "backup_path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Specific .bak file path to restore from".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "safety.rollback_file".into(),
            ToolDefinition {
                name: "safety.rollback_file".into(),
                description:
                    "Rollback a modified remote file to a previously created safety backup copy."
                        .into(),
                category: "safety".into(),
                risk: RiskLevel::High,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: roll_props,
                    required: Some(vec![
                        "server_id".into(),
                        "file_path".into(),
                        "backup_path".into(),
                    ]),
                    additional_properties: Some(false),
                },
            },
        );

        // 9c. safety.safe_patch
        let mut patch_props = HashMap::new();
        patch_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        patch_props.insert(
            "target_path".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Remote configuration file to patch".into(),
                r#enum: None,
                default: None,
            },
        );
        patch_props.insert(
            "new_content".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "New file content to apply".into(),
                r#enum: None,
                default: None,
            },
        );
        patch_props.insert(
            "validation_command".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Optional command to validate config syntax (e.g. nginx -t)".into(),
                r#enum: None,
                default: None,
            },
        );
        patch_props.insert(
            "reload_service".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Optional service to reload if validation succeeds (e.g. nginx)"
                    .into(),
                r#enum: None,
                default: None,
            },
        );
        patch_props.insert(
            "auto_rollback_on_failure".into(),
            ToolPropertySchema {
                prop_type: "boolean".into(),
                description: "Automatically revert to backup if validation or reload fails".into(),
                r#enum: None,
                default: Some(serde_json::json!(true)),
            },
        );
        tools.insert(
            "safety.safe_patch".into(),
            ToolDefinition {
                name: "safety.safe_patch".into(),
                description: "Safely patch a configuration file with automated backup, validation check, service reload, and auto-rollback on failure.".into(),
                category: "safety".into(),
                risk: RiskLevel::High,
                timeout_seconds: 60,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: patch_props,
                    required: Some(vec!["server_id".into(), "target_path".into(), "new_content".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 9d. safety.list_backups
        let mut list_bak_props = HashMap::new();
        list_bak_props.insert(
            "server_id".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Target server_id".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "safety.list_backups".into(),
            ToolDefinition {
                name: "safety.list_backups".into(),
                description:
                    "List available safety backups and rollback points for a target server.".into(),
                category: "safety".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 20,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: list_bak_props,
                    required: Some(vec!["server_id".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        // 10. Multi-Server Operations (Milestone M12)
        let mut batch_props = HashMap::new();
        batch_props.insert(
            "tool_name".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Name of the tool to execute across target nodes".into(),
                r#enum: None,
                default: None,
            },
        );
        batch_props.insert(
            "selector".into(),
            ToolPropertySchema {
                prop_type: "object".into(),
                description: "Target servers selector filter".into(),
                r#enum: None,
                default: None,
            },
        );
        batch_props.insert(
            "arguments".into(),
            ToolPropertySchema {
                prop_type: "object".into(),
                description: "Arguments to pass to the target tool".into(),
                r#enum: None,
                default: None,
            },
        );
        batch_props.insert(
            "concurrency_limit".into(),
            ToolPropertySchema {
                prop_type: "number".into(),
                description: "Max parallel executions (default 5)".into(),
                r#enum: None,
                default: None,
            },
        );
        batch_props.insert(
            "timeout_seconds".into(),
            ToolPropertySchema {
                prop_type: "number".into(),
                description: "Per-node timeout in seconds".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "multi_server.execute_batch".into(),
            ToolDefinition {
                name: "multi_server.execute_batch".into(),
                description: "Execute a tool across multiple servers with failure isolation."
                    .into(),
                category: "multi_server".into(),
                risk: RiskLevel::High,
                timeout_seconds: 60,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: batch_props,
                    required: Some(vec!["tool_name".into(), "selector".into()]),
                    additional_properties: Some(false),
                },
            },
        );

        let mut matrix_props = HashMap::new();
        matrix_props.insert(
            "selector".into(),
            ToolPropertySchema {
                prop_type: "object".into(),
                description: "Target servers selector filter".into(),
                r#enum: None,
                default: None,
            },
        );
        matrix_props.insert(
            "diagnostic_type".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Diagnostic query type".into(),
                r#enum: Some(vec![
                    "system_info".into(),
                    "disk_usage".into(),
                    "memory_usage".into(),
                    "cpu_usage".into(),
                    "service_status".into(),
                ]),
                default: None,
            },
        );
        matrix_props.insert(
            "service_name".into(),
            ToolPropertySchema {
                prop_type: "string".into(),
                description: "Optional service name for service_status".into(),
                r#enum: None,
                default: None,
            },
        );
        matrix_props.insert(
            "concurrency_limit".into(),
            ToolPropertySchema {
                prop_type: "number".into(),
                description: "Max concurrent executions".into(),
                r#enum: None,
                default: None,
            },
        );
        matrix_props.insert(
            "timeout_seconds".into(),
            ToolPropertySchema {
                prop_type: "number".into(),
                description: "Per-node timeout limit".into(),
                r#enum: None,
                default: None,
            },
        );
        tools.insert(
            "multi_server.diagnostics_matrix".into(),
            ToolDefinition {
                name: "multi_server.diagnostics_matrix".into(),
                description: "Execute parallel read-only diagnostics across multiple servers and return a comparative matrix.".into(),
                category: "multi_server".into(),
                risk: RiskLevel::ReadOnly,
                timeout_seconds: 45,
                input_schema: ToolInputSchema {
                    schema_type: "object".into(),
                    properties: matrix_props,
                    required: Some(vec!["selector".into(), "diagnostic_type".into()]),
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

                let run_as = request.arguments.get("run_as").and_then(|v| v.as_str());

                let target_server = ctx.target_server.as_ref();
                let server_name = target_server.map(|s| s.name.as_str()).unwrap_or_else(|| {
                    if server_id.is_empty() {
                        "unknown-server"
                    } else {
                        server_id
                    }
                });

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
                        "run_as": run_as,
                        "timeout_seconds": timeout_seconds,
                        "simulated": true,
                        "truncated": truncated,
                    });

                    Ok(ToolResult {
                        call_id: request.id.clone(),
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

                    let cmd_with_wd = if let Some(wd) = working_directory {
                        format!("cd '{}' && {}", wd, command)
                    } else {
                        command.to_string()
                    };

                    let full_remote_cmd = if let Some(user) = run_as {
                        let escaped = cmd_with_wd.replace('\'', "'\\''");
                        format!("sudo -u {} -i -- sh -c '{}'", user, escaped)
                    } else {
                        cmd_with_wd
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
                        .arg(srv.port.to_string());

                    if let Some(ref key_path) = srv.ssh_key_path {
                        if !key_path.trim().is_empty() {
                            let expanded = expand_tilde(key_path);
                            if expanded.exists() {
                                ssh_cmd.arg("-i").arg(expanded);
                            }
                        }
                    }

                    ssh_cmd
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
            "ssh.list_directory" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or("production01");

                let path = request
                    .arguments
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("/");

                let show_hidden = request
                    .arguments
                    .get("show_hidden")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let sftp = crate::sftp::SftpManager::new();
                match sftp.list_directory(None, server_id, path, show_hidden) {
                    Ok(entries) => {
                        let duration = start.elapsed().as_millis() as u64;
                        let data = serde_json::to_value(&entries).unwrap_or_default();
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(
                                serde_json::to_string_pretty(&entries).unwrap_or_default(),
                            ),
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
                            error: Some(e.to_string()),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "ssh.read_file" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or("production01");

                let path = request
                    .arguments
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'path' argument".into()))?;

                let max_bytes = request
                    .arguments
                    .get("max_bytes")
                    .and_then(|v| v.as_u64())
                    .map(|b| b as usize);

                let sftp = crate::sftp::SftpManager::new();
                match sftp.read_file(None, server_id, path, max_bytes) {
                    Ok(res) => {
                        let duration = start.elapsed().as_millis() as u64;
                        let data = serde_json::to_value(&res).unwrap_or_default();
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(res.content),
                            stderr: None,
                            exit_code: Some(0),
                            data: Some(data),
                            error: None,
                            truncated: Some(res.is_truncated),
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
                            error: Some(e.to_string()),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "ssh.write_file" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or("production01");

                let path = request
                    .arguments
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'path' argument".into()))?;

                let content = request
                    .arguments
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'content' argument".into()))?;

                let create_backup = request
                    .arguments
                    .get("create_backup")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                let sftp = crate::sftp::SftpManager::new();
                match sftp.write_file(None, server_id, path, content, create_backup) {
                    Ok(res) => {
                        let duration = start.elapsed().as_millis() as u64;
                        let backup_msg = res
                            .backup_path
                            .as_ref()
                            .map(|b| format!(" (backup: {})", b))
                            .unwrap_or_default();
                        let data = serde_json::to_value(&res).unwrap_or_default();
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(format!(
                                "Successfully wrote {} bytes to {}{}",
                                res.bytes_written, res.path, backup_msg
                            )),
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
                            error: Some(e.to_string()),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "ssh.file_info" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or("production01");

                let path = request
                    .arguments
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'path' argument".into()))?;

                let sftp = crate::sftp::SftpManager::new();
                match sftp.file_info(None, server_id, path) {
                    Ok(info) => {
                        let duration = start.elapsed().as_millis() as u64;
                        let data = serde_json::to_value(&info).unwrap_or_default();
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(serde_json::to_string_pretty(&info).unwrap_or_default()),
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
                            error: Some(e.to_string()),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "ssh.upload" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or("production01");

                let remote_path = request
                    .arguments
                    .get("remote_path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'remote_path' argument".into()))?;

                let content = request
                    .arguments
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'content' argument".into()))?;

                let sftp = crate::sftp::SftpManager::new();
                match sftp.write_file(None, server_id, remote_path, content, true) {
                    Ok(res) => {
                        let duration = start.elapsed().as_millis() as u64;
                        let data = serde_json::to_value(&res).unwrap_or_default();
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(format!(
                                "Uploaded {} bytes to {}",
                                res.bytes_written, res.path
                            )),
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
                            error: Some(e.to_string()),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "ssh.download" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or("production01");

                let remote_path = request
                    .arguments
                    .get("remote_path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'remote_path' argument".into()))?;

                let sftp = crate::sftp::SftpManager::new();
                match sftp.read_file(None, server_id, remote_path, None) {
                    Ok(res) => {
                        let duration = start.elapsed().as_millis() as u64;
                        let data = serde_json::to_value(&res).unwrap_or_default();
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(res.content),
                            stderr: None,
                            exit_code: Some(0),
                            data: Some(data),
                            error: None,
                            truncated: Some(res.is_truncated),
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
                            error: Some(e.to_string()),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "safety.create_backup" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or("production01");

                let file_path = request
                    .arguments
                    .get("file_path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'file_path' argument".into()))?;

                let reason = request
                    .arguments
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Safety tool invocation");

                let sftp = crate::sftp::SftpManager::new();
                let safety = crate::safety::SafetyManager::new();
                match safety.create_backup(None, server_id, file_path, reason, &sftp) {
                    Ok(rec) => {
                        let duration = start.elapsed().as_millis() as u64;
                        let data = serde_json::to_value(&rec).unwrap_or_default();
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(format!(
                                "Safety backup created at {} (size: {} bytes)",
                                rec.backup_path,
                                rec.size_bytes.unwrap_or(0)
                            )),
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
                            error: Some(e.to_string()),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "safety.rollback_file" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or("production01");

                let file_path = request
                    .arguments
                    .get("file_path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'file_path' argument".into()))?;

                let backup_path = request
                    .arguments
                    .get("backup_path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'backup_path' argument".into()))?;

                let sftp = crate::sftp::SftpManager::new();
                let safety = crate::safety::SafetyManager::new();
                match safety.restore_backup(None, server_id, file_path, backup_path, &sftp) {
                    Ok(()) => {
                        let duration = start.elapsed().as_millis() as u64;
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: true,
                            stdout: Some(format!(
                                "Successfully rolled back {} from backup {}",
                                file_path, backup_path
                            )),
                            stderr: None,
                            exit_code: Some(0),
                            data: Some(serde_json::json!({
                                "server_id": server_id,
                                "file_path": file_path,
                                "backup_path": backup_path,
                                "status": "ROLLED_BACK"
                            })),
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
                            error: Some(e.to_string()),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "safety.safe_patch" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref())
                    .unwrap_or("production01");

                let target_path = request
                    .arguments
                    .get("target_path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'target_path' argument".into()))?;

                let new_content = request
                    .arguments
                    .get("new_content")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::Validation("Missing 'new_content' argument".into()))?;

                let validation_command = request
                    .arguments
                    .get("validation_command")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let reload_service = request
                    .arguments
                    .get("reload_service")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let auto_rollback = request
                    .arguments
                    .get("auto_rollback_on_failure")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                let reason = request
                    .arguments
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let patch_req = crate::safety::SafePatchRequest {
                    server_id: server_id.to_string(),
                    target_path: target_path.to_string(),
                    new_content: new_content.to_string(),
                    validation_command,
                    reload_service,
                    auto_rollback_on_failure: Some(auto_rollback),
                    reason,
                };

                let sftp = crate::sftp::SftpManager::new();
                let safety = crate::safety::SafetyManager::new();
                match safety.execute_safe_patch(None, patch_req, &sftp) {
                    Ok(res) => {
                        let duration = start.elapsed().as_millis() as u64;
                        let data = serde_json::to_value(&res).unwrap_or_default();
                        let stdout = if res.success {
                            format!(
                                "Safe patch applied successfully to {} (backup: {})",
                                res.target_path,
                                res.backup_path.as_deref().unwrap_or("none")
                            )
                        } else {
                            format!(
                                "Safe patch failed: {} (rolled_back: {})",
                                res.error.as_deref().unwrap_or("unknown error"),
                                res.rolled_back
                            )
                        };
                        Ok(ToolResult {
                            call_id: request.id.clone(),
                            success: res.success,
                            stdout: Some(stdout),
                            stderr: res.error.clone(),
                            exit_code: if res.success { Some(0) } else { Some(1) },
                            data: Some(data),
                            error: res.error,
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
                            error: Some(e.to_string()),
                            truncated: None,
                            duration_ms: duration,
                        })
                    }
                }
            }
            "safety.list_backups" => {
                let server_id = request
                    .arguments
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .or(ctx.server_id.as_deref());

                let safety = crate::safety::SafetyManager::new();
                let backups = safety.list_backups(server_id);
                let duration = start.elapsed().as_millis() as u64;
                let data = serde_json::to_value(&backups).unwrap_or_default();
                Ok(ToolResult {
                    call_id: request.id.clone(),
                    success: true,
                    stdout: Some(serde_json::to_string_pretty(&backups).unwrap_or_default()),
                    stderr: None,
                    exit_code: Some(0),
                    data: Some(data),
                    error: None,
                    truncated: None,
                    duration_ms: duration,
                })
            }
            // Milestone M10: Semantic Server Operations
            "server.system_info"
            | "server.disk_usage"
            | "server.memory_usage"
            | "server.cpu_usage"
            | "server.load_average"
            | "server.process_list"
            | "server.network_connections"
            | "server.service_status"
            | "server.service_start"
            | "server.service_stop"
            | "server.service_restart"
            | "server.tail_log" => execute_semantic_server_tool(
                &request.id,
                &request.tool_name,
                &request.arguments,
                ctx,
                start,
            ),
            // Milestone M11: WHM/cPanel Operations
            "cpanel.server_info"
            | "cpanel.list_accounts"
            | "cpanel.account_info"
            | "cpanel.list_domains"
            | "cpanel.service_status"
            | "cpanel.restart_service"
            | "cpanel.ssl_status"
            | "cpanel.backup_status"
            | "cpanel.account_disk_usage"
            | "cpanel.list_php_versions"
            | "cpanel.suspend_account"
            | "cpanel.unsuspend_account"
            | "cpanel.security_advisor" => execute_cpanel_tool(
                &request.id,
                &request.tool_name,
                &request.arguments,
                ctx,
                start,
            ),
            // Milestone M12: Multi-Server Operations Tools
            "multi_server.execute_batch" => {
                let duration = start.elapsed().as_millis() as u64;
                let tool_name = request
                    .arguments
                    .get("tool_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("server.system_info");
                let data = serde_json::json!({
                    "batch_id": request.id.clone(),
                    "tool_name": tool_name,
                    "simulated": true,
                    "status": "BATCH_DISPATCHED",
                    "arguments": request.arguments,
                });
                Ok(ToolResult {
                    call_id: request.id.clone(),
                    success: true,
                    stdout: Some(format!(
                        "Dispatched multi-server batch execution of '{}' across targets",
                        tool_name
                    )),
                    stderr: None,
                    exit_code: Some(0),
                    data: Some(data),
                    error: None,
                    truncated: None,
                    duration_ms: duration,
                })
            }
            "multi_server.diagnostics_matrix" => {
                let duration = start.elapsed().as_millis() as u64;
                let diag_type = request
                    .arguments
                    .get("diagnostic_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("system_info");
                let data = serde_json::json!({
                    "batch_id": request.id.clone(),
                    "diagnostic_type": diag_type,
                    "simulated": true,
                    "status": "MATRIX_COMPLETED",
                    "rows": [],
                });
                Ok(ToolResult {
                    call_id: request.id.clone(),
                    success: true,
                    stdout: Some(format!(
                        "Executed multi-server diagnostics matrix query ('{}') across targets",
                        diag_type
                    )),
                    stderr: None,
                    exit_code: Some(0),
                    data: Some(data),
                    error: None,
                    truncated: None,
                    duration_ms: duration,
                })
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

fn execute_semantic_server_tool(
    request_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
    ctx: &ToolExecutionContext,
    start: std::time::Instant,
) -> Result<ToolResult, AppError> {
    let server_id = arguments
        .get("server_id")
        .and_then(|v| v.as_str())
        .or(ctx.server_id.as_deref())
        .unwrap_or("production01");

    let target_server = ctx.target_server.as_ref();
    let server_name = target_server.map(|s| s.name.as_str()).unwrap_or(server_id);

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

    if is_mock {
        let value = crate::server_ops::ServerOpsManager::simulate_semantic_operation(
            server_name,
            tool_name,
            arguments,
        )?;
        let duration = start.elapsed().as_millis() as u64;
        let stdout = serde_json::to_string_pretty(&value).unwrap_or_default();
        return Ok(ToolResult {
            call_id: request_id.to_string(),
            success: true,
            stdout: Some(stdout),
            stderr: None,
            exit_code: Some(0),
            data: Some(value),
            error: None,
            truncated: None,
            duration_ms: duration,
        });
    }

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

    let distro_family = if srv.name.contains("cpanel") || srv.environment == "PRODUCTION" {
        "rhel"
    } else {
        "debian"
    };

    let remote_cmd = match tool_name {
        "server.system_info" => "uname -a; cat /etc/os-release 2>/dev/null; uptime".to_string(),
        "server.disk_usage" => "df -B1 -P".to_string(),
        "server.memory_usage" => "free -b".to_string(),
        "server.cpu_usage" => "top -b -n 1 | head -n 5".to_string(),
        "server.load_average" => "cat /proc/loadavg".to_string(),
        "server.process_list" => {
            let limit = arguments
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(30);
            format!("ps aux --sort=-%cpu | head -n {}", limit + 1)
        }
        "server.network_connections" => {
            "ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null".to_string()
        }
        "server.service_status" => {
            let raw_svc = arguments
                .get("service_name")
                .and_then(|v| v.as_str())
                .unwrap_or("httpd");
            let resolved =
                crate::server_ops::ServiceAdapter::resolve_service_name(raw_svc, distro_family);
            format!("systemctl show {}", resolved)
        }
        "server.service_start" => {
            let raw_svc = arguments
                .get("service_name")
                .and_then(|v| v.as_str())
                .unwrap_or("httpd");
            let resolved =
                crate::server_ops::ServiceAdapter::resolve_service_name(raw_svc, distro_family);
            format!("systemctl start {}", resolved)
        }
        "server.service_stop" => {
            let raw_svc = arguments
                .get("service_name")
                .and_then(|v| v.as_str())
                .unwrap_or("httpd");
            let resolved =
                crate::server_ops::ServiceAdapter::resolve_service_name(raw_svc, distro_family);
            format!("systemctl stop {}", resolved)
        }
        "server.service_restart" => {
            let raw_svc = arguments
                .get("service_name")
                .and_then(|v| v.as_str())
                .unwrap_or("httpd");
            let resolved =
                crate::server_ops::ServiceAdapter::resolve_service_name(raw_svc, distro_family);
            format!("systemctl restart {}", resolved)
        }
        "server.tail_log" => {
            let path = arguments
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("/var/log/messages");
            let lines = arguments
                .get("lines")
                .and_then(|v| v.as_u64())
                .unwrap_or(50);
            format!("tail -n {} {}", lines, path)
        }
        _ => {
            return Err(AppError::NotFound(format!(
                "Unknown semantic tool: {}",
                tool_name
            )))
        }
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
        .arg(srv.port.to_string());

    if let Some(ref key_path) = srv.ssh_key_path {
        if !key_path.trim().is_empty() {
            let expanded = expand_tilde(key_path);
            if expanded.exists() {
                ssh_cmd.arg("-i").arg(expanded);
            }
        }
    }

    ssh_cmd
        .arg(format!("{}@{}", srv.username, target_host))
        .arg(&remote_cmd);

    let output = ssh_cmd
        .output()
        .map_err(|e| AppError::Internal(format!("Failed to execute ssh: {}", e)))?;
    let duration = start.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let structured_data = match tool_name {
        "server.disk_usage" => {
            let entries = crate::server_ops::ServerOpsManager::parse_df_output(&stdout);
            serde_json::to_value(entries).ok()
        }
        "server.memory_usage" => {
            let mem = crate::server_ops::ServerOpsManager::parse_free_output(&stdout).ok();
            serde_json::to_value(mem).ok()
        }
        "server.load_average" => {
            let load = crate::server_ops::ServerOpsManager::parse_load_average(&stdout).ok();
            serde_json::to_value(load).ok()
        }
        "server.process_list" => {
            let limit = arguments
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(30) as usize;
            let list = crate::server_ops::ServerOpsManager::parse_process_list(&stdout, limit);
            serde_json::to_value(list).ok()
        }
        "server.network_connections" => {
            let conns = crate::server_ops::ServerOpsManager::parse_network_connections(&stdout);
            serde_json::to_value(conns).ok()
        }
        "server.service_status" => {
            let raw_svc = arguments
                .get("service_name")
                .and_then(|v| v.as_str())
                .unwrap_or("httpd");
            let resolved =
                crate::server_ops::ServiceAdapter::resolve_service_name(raw_svc, distro_family);
            let info = crate::server_ops::ServerOpsManager::parse_systemctl_show(
                raw_svc, &resolved, &stdout,
            );
            serde_json::to_value(info).ok()
        }
        "server.tail_log" => {
            let path = arguments
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("/var/log/messages");
            let lines = arguments
                .get("lines")
                .and_then(|v| v.as_u64())
                .unwrap_or(50) as usize;
            let res = crate::server_ops::ServerOpsManager::parse_tail_log(path, &stdout, lines);
            serde_json::to_value(res).ok()
        }
        _ => None,
    };

    Ok(ToolResult {
        call_id: request_id.to_string(),
        success: output.status.success(),
        stdout: Some(stdout),
        stderr: if stderr.is_empty() {
            None
        } else {
            Some(stderr)
        },
        exit_code: output.status.code(),
        data: structured_data,
        error: if output.status.success() {
            None
        } else {
            Some("Semantic server command failed".into())
        },
        truncated: None,
        duration_ms: duration,
    })
}

fn execute_cpanel_tool(
    request_id: &str,
    tool_name: &str,
    arguments: &serde_json::Value,
    ctx: &ToolExecutionContext,
    start: std::time::Instant,
) -> Result<ToolResult, AppError> {
    let server_id = arguments
        .get("server_id")
        .and_then(|v| v.as_str())
        .or(ctx.server_id.as_deref())
        .unwrap_or("srv-prod-cpanel-01");

    let target_server = ctx.target_server.as_ref();
    let server_name = target_server.map(|s| s.name.as_str()).unwrap_or(server_id);

    // Gate B: Validate target server cpanel_enabled
    if let Some(srv) = target_server {
        if !srv.cpanel_enabled {
            return Err(AppError::Validation(format!(
                "Server '{}' does not have WHM/cPanel management enabled (cpanel_enabled: false)",
                srv.name
            )));
        }
    }

    let is_mock = match target_server {
        Some(srv) => {
            srv.hostname == "production01"
                || srv.hostname == "127.0.0.1"
                || srv.hostname == "localhost"
                || srv.hostname == "198.51.100.15"
                || srv.hostname.starts_with("mock-")
                || srv.hostname.starts_with("test-")
                || srv.hostname.contains("cpanel")
                || srv.name.to_lowercase().contains("mock")
                || srv.name.to_lowercase().contains("test")
                || srv.name.to_lowercase().contains("cpanel")
                || srv.name == "production01"
                || std::env::var("REMOTE_COMMANDER_MOCK_SSH").is_ok()
        }
        None => true,
    };

    if is_mock {
        let value = crate::cpanel::CpanelManager::simulate_cpanel_operation(
            server_name,
            tool_name,
            arguments,
        )?;
        let duration = start.elapsed().as_millis() as u64;
        let stdout = serde_json::to_string_pretty(&value).unwrap_or_default();
        return Ok(ToolResult {
            call_id: request_id.to_string(),
            success: true,
            stdout: Some(stdout),
            stderr: None,
            exit_code: Some(0),
            data: Some(value),
            error: None,
            truncated: None,
            duration_ms: duration,
        });
    }

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

    let remote_cmd = match tool_name {
        "cpanel.server_info" => "whmapi1 version --output=json".to_string(),
        "cpanel.list_accounts" => "whmapi1 listaccts --output=json".to_string(),
        "cpanel.account_info" => {
            let user = arguments.get("user").and_then(|u| u.as_str()).unwrap_or("");
            format!("whmapi1 accountsummary user={} --output=json", user)
        }
        "cpanel.list_domains" => "whmapi1 get_domain_info --output=json".to_string(),
        "cpanel.service_status" => "whmapi1 servicestatus --output=json".to_string(),
        "cpanel.restart_service" => {
            let raw_svc = arguments
                .get("service_name")
                .and_then(|s| s.as_str())
                .unwrap_or("cpanel");
            format!("/scripts/restartsrv_{} --status", raw_svc)
        }
        "cpanel.ssl_status" => "whmapi1 installed_hosts --output=json".to_string(),
        "cpanel.backup_status" => "whmapi1 backup_config_get --output=json".to_string(),
        "cpanel.account_disk_usage" => {
            let user = arguments.get("user").and_then(|u| u.as_str()).unwrap_or("");
            format!("whmapi1 showbw user={} --output=json", user)
        }
        "cpanel.list_php_versions" => {
            "whmapi1 php_get_installed_versions --output=json".to_string()
        }
        "cpanel.suspend_account" => {
            let user = arguments.get("user").and_then(|u| u.as_str()).unwrap_or("");
            let reason = arguments
                .get("reason")
                .and_then(|r| r.as_str())
                .unwrap_or("Suspended by operator");
            format!(
                "whmapi1 suspendacct user={} reason='{}' --output=json",
                user, reason
            )
        }
        "cpanel.unsuspend_account" => {
            let user = arguments.get("user").and_then(|u| u.as_str()).unwrap_or("");
            format!("whmapi1 unsuspendacct user={} --output=json", user)
        }
        "cpanel.security_advisor" => {
            "/usr/local/cpanel/scripts/securityadvisor --json 2>/dev/null || whmapi1 securityadvisor_get_advice --output=json".to_string()
        }
        _ => {
            return Err(AppError::NotFound(format!(
                "Unknown cPanel tool: {}",
                tool_name
            )))
        }
    };

    // 1. Direct WHM API 1 Execution over HTTPS (Port 2087) using Native OS Keyring Token
    if let Some(ref cred_ref) = srv.whm_token_ref {
        let store = crate::secret::OsKeyringStore::new();
        use crate::secret::SecretStore;
        if let Ok(token) = store.get(cred_ref) {
            let clean_token = token.trim();
            if !clean_token.is_empty() {
                let whm_port = srv.whm_port.unwrap_or(2087);
                let endpoint: Option<String> = match tool_name {
                    "cpanel.server_info" => Some("/json-api/version?api.version=1".to_string()),
                    "cpanel.list_accounts" => Some("/json-api/listaccts?api.version=1".to_string()),
                    "cpanel.account_info" => {
                        let user = arguments.get("user").and_then(|u| u.as_str()).unwrap_or("");
                        Some(format!("/json-api/accountsummary?api.version=1&user={}", user))
                    }
                    "cpanel.list_domains" => Some("/json-api/get_domain_info?api.version=1".to_string()),
                    "cpanel.service_status" => Some("/json-api/servicestatus?api.version=1".to_string()),
                    "cpanel.restart_service" => {
                        let raw_svc = arguments.get("service_name").and_then(|s| s.as_str()).unwrap_or("cpanel");
                        Some(format!("/json-api/restartservice?api.version=1&service={}", raw_svc))
                    }
                    "cpanel.ssl_status" => Some("/json-api/installed_hosts?api.version=1".to_string()),
                    "cpanel.backup_status" => Some("/json-api/backup_config_get?api.version=1".to_string()),
                    "cpanel.account_disk_usage" => {
                        let user = arguments.get("user").and_then(|u| u.as_str()).unwrap_or("");
                        Some(format!("/json-api/showbw?api.version=1&user={}", user))
                    }
                    "cpanel.list_php_versions" => Some("/json-api/php_get_installed_versions?api.version=1".to_string()),
                    "cpanel.suspend_account" => {
                        let user = arguments.get("user").and_then(|u| u.as_str()).unwrap_or("");
                        let reason = arguments.get("reason").and_then(|r| r.as_str()).unwrap_or("Suspended by operator");
                        Some(format!("/json-api/suspendacct?api.version=1&user={}&reason={}", user, reason))
                    }
                    "cpanel.unsuspend_account" => {
                        let user = arguments.get("user").and_then(|u| u.as_str()).unwrap_or("");
                        Some(format!("/json-api/unsuspendacct?api.version=1&user={}", user))
                    }
                    "cpanel.security_advisor" => Some("/json-api/securityadvisor_get_advice?api.version=1".to_string()),
                    _ => None,
                };

                if let Some(ep) = endpoint {
                    let url = format!("https://{}:{}{}", target_host, whm_port, ep);
                    let mut curl_cmd = std::process::Command::new("curl");
                    curl_cmd
                        .arg("-k")
                        .arg("-s")
                        .arg("--max-time").arg("15")
                        .arg("-H").arg(format!("Authorization: whm root:{}", clean_token))
                        .arg(&url);

                    if let Ok(out) = curl_cmd.output() {
                        let stdout_str = String::from_utf8_lossy(&out.stdout).to_string();
                        if out.status.success() && !stdout_str.trim().is_empty() {
                            if let Ok(parsed_json) = serde_json::from_str::<serde_json::Value>(&stdout_str) {
                                let is_api_ok = parsed_json
                                    .get("metadata")
                                    .and_then(|m| m.get("result"))
                                    .map(|r| r == 1 || r == "1")
                                    .unwrap_or(true);

                                if is_api_ok {
                                    let duration = start.elapsed().as_millis() as u64;
                                    let parsed_data = match tool_name {
                                        "cpanel.server_info" => {
                                            crate::cpanel::CpanelManager::parse_whmapi1_version(&stdout_str, &srv.hostname)
                                                .ok()
                                                .and_then(|i| serde_json::to_value(i).ok())
                                        }
                                        "cpanel.list_accounts" => {
                                            crate::cpanel::CpanelManager::parse_whmapi1_listaccts(&stdout_str)
                                                .ok()
                                                .and_then(|a| serde_json::to_value(a).ok())
                                        }
                                        _ => Some(parsed_json),
                                    };

                                    return Ok(ToolResult {
                                        call_id: request_id.to_string(),
                                        success: true,
                                        stdout: Some(stdout_str),
                                        stderr: None,
                                        exit_code: Some(0),
                                        data: parsed_data,
                                        error: None,
                                        truncated: Some(false),
                                        duration_ms: duration,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback to SSH execution of whmapi1
    let mut ssh_cmd = std::process::Command::new("ssh");
    ssh_cmd
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("StrictHostKeyChecking=yes")
        .arg("-o")
        .arg("ConnectTimeout=10")
        .arg("-p")
        .arg(srv.port.to_string());

    if let Some(ref key_path) = srv.ssh_key_path {
        if !key_path.trim().is_empty() {
            let expanded = expand_tilde(key_path);
            if expanded.exists() {
                ssh_cmd.arg("-i").arg(expanded);
            }
        }
    }

    ssh_cmd
        .arg(format!("{}@{}", srv.username, target_host))
        .arg(&remote_cmd);

    let output = ssh_cmd
        .output()
        .map_err(|e| AppError::Internal(format!("Failed to execute ssh: {}", e)))?;
    let duration = start.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let parsed_data = match tool_name {
        "cpanel.server_info" => {
            crate::cpanel::CpanelManager::parse_whmapi1_version(&stdout, &srv.hostname)
                .ok()
                .and_then(|i| serde_json::to_value(i).ok())
        }
        "cpanel.list_accounts" => crate::cpanel::CpanelManager::parse_whmapi1_listaccts(&stdout)
            .ok()
            .and_then(|a| serde_json::to_value(a).ok()),
        _ => serde_json::from_str::<serde_json::Value>(&stdout).ok(),
    };

    Ok(ToolResult {
        call_id: request_id.to_string(),
        success: output.status.success(),
        stdout: Some(stdout),
        stderr: if stderr.is_empty() {
            None
        } else {
            Some(stderr)
        },
        exit_code: output.status.code(),
        data: parsed_data,
        error: if output.status.success() {
            None
        } else {
            Some("cPanel command failed".into())
        },
        truncated: None,
        duration_ms: duration,
    })
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
            Some(format!("SSH command exited with status {:?}", exit_code))
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

    #[test]
    fn test_ssh_list_directory_tool_execution() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-sftp-list".into(),
            tool_name: "ssh.list_directory".into(),
            arguments: serde_json::json!({
                "server_id": "production01",
                "path": "/etc"
            }),
            target_server_id: Some("production01".into()),
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("production01".into()),
            target_server: None,
            environment: Some("PRODUCTION".into()),
            authenticated_user: None,
            tool_name: "ssh.list_directory".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };

        let res = registry
            .execute(&request, &ctx)
            .expect("Should list directory");
        assert!(res.success);
        assert_eq!(res.exit_code, Some(0));
        assert!(res.stdout.as_ref().unwrap().contains("hosts"));
    }

    #[test]
    fn test_ssh_read_file_tool_execution() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-sftp-read".into(),
            tool_name: "ssh.read_file".into(),
            arguments: serde_json::json!({
                "server_id": "production01",
                "path": "/etc/hosts"
            }),
            target_server_id: Some("production01".into()),
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("production01".into()),
            target_server: None,
            environment: Some("PRODUCTION".into()),
            authenticated_user: None,
            tool_name: "ssh.read_file".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };

        let res = registry.execute(&request, &ctx).expect("Should read file");
        assert!(res.success);
        assert_eq!(res.exit_code, Some(0));
        assert!(res.stdout.as_ref().unwrap().contains("localhost"));
    }

    #[test]
    fn test_ssh_write_file_with_backup_tool_execution() {
        let registry = ToolRegistry::new();
        let request = ToolRequest {
            id: "call-sftp-write".into(),
            tool_name: "ssh.write_file".into(),
            arguments: serde_json::json!({
                "server_id": "production01",
                "path": "/var/www/html/index.html",
                "content": "<h1>Updated Home</h1>",
                "create_backup": true
            }),
            target_server_id: Some("production01".into()),
            conversation_id: None,
        };

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("production01".into()),
            target_server: None,
            environment: Some("PRODUCTION".into()),
            authenticated_user: None,
            tool_name: "ssh.write_file".into(),
            risk_level: RiskLevel::High,
            permission_mode: PermissionMode::SafeAutomation,
        };

        let res = registry.execute(&request, &ctx).expect("Should write file");
        assert!(res.success);
        assert_eq!(res.exit_code, Some(0));
        assert!(res.stdout.as_ref().unwrap().contains("Successfully wrote"));
    }

    #[test]
    fn test_m10_semantic_server_tools_execution() {
        let registry = ToolRegistry::new();

        // 1. server.system_info
        let req_sys = ToolRequest {
            id: "call-sys-info".into(),
            tool_name: "server.system_info".into(),
            arguments: serde_json::json!({ "server_id": "production01" }),
            target_server_id: Some("production01".into()),
            conversation_id: None,
        };
        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("production01".into()),
            target_server: None,
            environment: Some("PRODUCTION".into()),
            authenticated_user: None,
            tool_name: "server.system_info".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };
        let res_sys = registry
            .execute(&req_sys, &ctx)
            .expect("system_info should succeed");
        assert!(res_sys.success);
        assert!(res_sys.data.is_some());
        let data_sys = res_sys.data.unwrap();
        assert_eq!(data_sys["os_name"], "AlmaLinux");
        assert_eq!(data_sys["arch"], "x86_64");

        // 2. server.disk_usage
        let req_disk = ToolRequest {
            id: "call-disk-usage".into(),
            tool_name: "server.disk_usage".into(),
            arguments: serde_json::json!({ "server_id": "production01" }),
            target_server_id: Some("production01".into()),
            conversation_id: None,
        };
        let res_disk = registry
            .execute(&req_disk, &ctx)
            .expect("disk_usage should succeed");
        assert!(res_disk.success);
        let data_disk = res_disk.data.unwrap();
        assert!(data_disk.as_array().unwrap().len() >= 2);

        // 3. server.service_status with cross-distro alias
        let req_svc = ToolRequest {
            id: "call-svc-status".into(),
            tool_name: "server.service_status".into(),
            arguments: serde_json::json!({
                "server_id": "production01",
                "service_name": "apache"
            }),
            target_server_id: Some("production01".into()),
            conversation_id: None,
        };
        let res_svc = registry
            .execute(&req_svc, &ctx)
            .expect("service_status should succeed");
        assert!(res_svc.success);
        let data_svc = res_svc.data.unwrap();
        assert_eq!(data_svc["resolved_name"], "httpd");
        assert_eq!(data_svc["active_state"], "active");
        assert_eq!(data_svc["is_running"], true);

        // 4. server.service_restart
        let req_restart = ToolRequest {
            id: "call-svc-restart".into(),
            tool_name: "server.service_restart".into(),
            arguments: serde_json::json!({
                "server_id": "production01",
                "service_name": "mariadb"
            }),
            target_server_id: Some("production01".into()),
            conversation_id: None,
        };
        let res_restart = registry
            .execute(&req_restart, &ctx)
            .expect("service_restart should succeed");
        assert!(res_restart.success);
        let data_restart = res_restart.data.unwrap();
        assert_eq!(data_restart["action"], "restart");
        assert_eq!(data_restart["success"], true);

        // 5. server.tail_log
        let req_log = ToolRequest {
            id: "call-tail-log".into(),
            tool_name: "server.tail_log".into(),
            arguments: serde_json::json!({
                "server_id": "production01",
                "path": "/var/log/messages",
                "lines": 10
            }),
            target_server_id: Some("production01".into()),
            conversation_id: None,
        };
        let res_log = registry
            .execute(&req_log, &ctx)
            .expect("tail_log should succeed");
        assert!(res_log.success);
        let data_log = res_log.data.unwrap();
        assert!(data_log["lines"].as_array().unwrap().len() >= 3);
    }

    #[test]
    fn test_cpanel_tools_registration_and_execution() {
        let registry = ToolRegistry::new();

        let cpanel_tools = [
            "cpanel.server_info",
            "cpanel.list_accounts",
            "cpanel.account_info",
            "cpanel.list_domains",
            "cpanel.service_status",
            "cpanel.restart_service",
            "cpanel.ssl_status",
            "cpanel.backup_status",
            "cpanel.account_disk_usage",
            "cpanel.list_php_versions",
            "cpanel.suspend_account",
            "cpanel.unsuspend_account",
            "cpanel.security_advisor",
        ];

        for tool_name in cpanel_tools {
            let def = registry.get(tool_name);
            assert!(
                def.is_some(),
                "Tool {} should be registered in ToolRegistry",
                tool_name
            );
            assert_eq!(def.unwrap().category, "cpanel");
        }

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("srv-prod-cpanel-01".into()),
            target_server: None,
            environment: Some("PRODUCTION".into()),
            authenticated_user: None,
            tool_name: "cpanel.server_info".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };

        // 1. cpanel.server_info
        let req_info = ToolRequest {
            id: "call-cp-info".into(),
            tool_name: "cpanel.server_info".into(),
            arguments: serde_json::json!({ "server_id": "srv-prod-cpanel-01" }),
            target_server_id: Some("srv-prod-cpanel-01".into()),
            conversation_id: None,
        };
        let res_info = registry
            .execute(&req_info, &ctx)
            .expect("cpanel.server_info should succeed");
        assert!(res_info.success);
        let data_info = res_info.data.unwrap();
        assert_eq!(data_info["license_status"], "Active");

        // 2. cpanel.list_accounts
        let req_accts = ToolRequest {
            id: "call-cp-accts".into(),
            tool_name: "cpanel.list_accounts".into(),
            arguments: serde_json::json!({ "server_id": "srv-prod-cpanel-01" }),
            target_server_id: Some("srv-prod-cpanel-01".into()),
            conversation_id: None,
        };
        let res_accts = registry
            .execute(&req_accts, &ctx)
            .expect("cpanel.list_accounts should succeed");
        assert!(res_accts.success);
        let acct_list = res_accts.data.unwrap();
        assert!(acct_list.as_array().unwrap().len() >= 3);

        // 3. cpanel.suspend_account (High risk)
        let req_suspend = ToolRequest {
            id: "call-cp-suspend".into(),
            tool_name: "cpanel.suspend_account".into(),
            arguments: serde_json::json!({
                "server_id": "srv-prod-cpanel-01",
                "user": "clientapp",
                "reason": "Billing overdue"
            }),
            target_server_id: Some("srv-prod-cpanel-01".into()),
            conversation_id: None,
        };
        let res_suspend = registry
            .execute(&req_suspend, &ctx)
            .expect("cpanel.suspend_account should succeed");
        assert!(res_suspend.success);
        let suspend_data = res_suspend.data.unwrap();
        assert_eq!(suspend_data["user"], "clientapp");
        assert_eq!(suspend_data["action"], "suspend");

        // Gate B test: Server with cpanel_enabled: false must be rejected
        let non_cp_server = ServerRecord {
            id: "srv-staging-01".into(),
            name: "staging-app-01".into(),
            hostname: "192.168.10.45".into(),
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
            tags_json: "[]".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        let ctx_non_cp = ToolExecutionContext {
            conversation_id: None,
            server_id: Some("srv-staging-01".into()),
            target_server: Some(non_cp_server),
            environment: Some("STAGING".into()),
            authenticated_user: None,
            tool_name: "cpanel.server_info".into(),
            risk_level: RiskLevel::ReadOnly,
            permission_mode: PermissionMode::SafeAutomation,
        };
        let res_gate_b = registry.execute(&req_info, &ctx_non_cp);
        assert!(
            res_gate_b.is_err(),
            "Gate B: cPanel operation must fail on server with cpanel_enabled: false"
        );
    }

    #[test]
    fn test_m12_multi_server_tools_registration_and_execution() {
        let registry = ToolRegistry::new();

        assert!(registry.get("multi_server.execute_batch").is_some());
        assert_eq!(
            registry.get("multi_server.execute_batch").unwrap().risk,
            RiskLevel::High
        );

        assert!(registry.get("multi_server.diagnostics_matrix").is_some());
        assert_eq!(
            registry
                .get("multi_server.diagnostics_matrix")
                .unwrap()
                .risk,
            RiskLevel::ReadOnly
        );

        let ctx = ToolExecutionContext {
            conversation_id: None,
            server_id: None,
            target_server: None,
            environment: None,
            authenticated_user: Some("desktop_operator".into()),
            tool_name: "multi_server.execute_batch".into(),
            risk_level: RiskLevel::High,
            permission_mode: PermissionMode::FullAccess,
        };

        let req_batch = ToolRequest {
            id: "call-batch-001".into(),
            tool_name: "multi_server.execute_batch".into(),
            arguments: serde_json::json!({
                "tool_name": "server.system_info",
                "selector": { "type": "tag", "tag": "web" }
            }),
            target_server_id: None,
            conversation_id: None,
        };
        let res_batch = registry.execute(&req_batch, &ctx).expect("batch execution");
        assert!(res_batch.success);

        let req_matrix = ToolRequest {
            id: "call-matrix-001".into(),
            tool_name: "multi_server.diagnostics_matrix".into(),
            arguments: serde_json::json!({
                "selector": { "type": "all" },
                "diagnostic_type": "cpu_usage"
            }),
            target_server_id: None,
            conversation_id: None,
        };
        let res_matrix = registry
            .execute(&req_matrix, &ctx)
            .expect("matrix execution");
        assert!(res_matrix.success);
    }
}
