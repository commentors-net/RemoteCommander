//! SSH Transport Implementation
//! Master Spec §0.3, §8: System OpenSSH integration + Mock Transport for testing.
//! Enforces Security Gate E (host verification) and Gate B (stable server identity).

use crate::error::AppError;
use crate::models::{ConnectionTestResult, HostKeyInfo, HostKeyStatus, ServerRecord};
use crate::ssh::fingerprint::parse_host_key_entry;
use crate::ssh::known_hosts::KnownHostsManager;
use crate::ssh::ssh_config::resolve_alias;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use std::time::Instant;
use tokio::process::Command;

pub trait SshTransport: Send + Sync {
    fn test_connection<'a>(
        &'a self,
        server: &'a ServerRecord,
        known_hosts: &'a mut KnownHostsManager,
        secret_override: Option<&'a str>,
    ) -> Pin<Box<dyn Future<Output = Result<ConnectionTestResult, AppError>> + Send + 'a>>;

    fn fetch_host_key<'a>(
        &'a self,
        hostname: &'a str,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<HostKeyInfo, AppError>> + Send + 'a>>;
}

// --- System OpenSSH Transport ---

pub struct SystemOpenSshTransport;

impl SystemOpenSshTransport {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SystemOpenSshTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl SshTransport for SystemOpenSshTransport {
    fn fetch_host_key<'a>(
        &'a self,
        hostname: &'a str,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<HostKeyInfo, AppError>> + Send + 'a>> {
        Box::pin(async move {
            // Use ssh-keyscan to query remote host key without executing a full login
            let mut cmd = Command::new("ssh-keyscan");
            cmd.arg("-p")
                .arg(port.to_string())
                .arg("-T")
                .arg("5") // 5 second timeout
                .arg(hostname);

            let output = cmd.output().await.map_err(|e| {
                AppError::ExecutionFailed(format!("Failed to execute ssh-keyscan: {}", e))
            })?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Some((_, _, info)) = parse_host_key_entry(line) {
                    return Ok(info);
                }
            }

            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(AppError::ExecutionFailed(format!(
                "Unable to retrieve host key from {}:{}. Stderr: {}",
                hostname, port, stderr
            )))
        })
    }

    fn test_connection<'a>(
        &'a self,
        server: &'a ServerRecord,
        known_hosts: &'a mut KnownHostsManager,
        _secret_override: Option<&'a str>,
    ) -> Pin<Box<dyn Future<Output = Result<ConnectionTestResult, AppError>> + Send + 'a>> {
        Box::pin(async move {
            let start = Instant::now();

            // Resolve potential alias in ~/.ssh/config
            let target_host = if let Some(ref alias) = server.ssh_config_alias {
                if let Some(resolved) = resolve_alias(alias) {
                    resolved.hostname
                } else {
                    server.hostname.clone()
                }
            } else {
                server.hostname.clone()
            };

            let port = server.port;
            let username = &server.username;

            // 1. Fetch remote host key
            let host_key_result = self.fetch_host_key(&target_host, port).await;
            let latency_ms = start.elapsed().as_millis() as u64;

            let host_key = match host_key_result {
                Ok(hk) => hk,
                Err(err) => {
                    return Ok(ConnectionTestResult {
                        success: false,
                        server_id: server.id.clone(),
                        server_name: server.name.clone(),
                        hostname: target_host,
                        port,
                        username: username.clone(),
                        host_key: None,
                        host_key_status: "UNVERIFIED".into(),
                        previous_fingerprint: None,
                        new_fingerprint: None,
                        latency_ms,
                        server_version_banner: None,
                        error_message: Some(err.to_string()),
                    });
                }
            };

            // 2. Verify Host Key against known_hosts (Security Gate E)
            let verification = known_hosts.verify_host_key(&target_host, port, &host_key);

            match verification {
                HostKeyStatus::ChangedWarning {
                    previous_fingerprint,
                    new_fingerprint,
                    ..
                } => {
                    // CRITICAL GATE E: Host key changed! Must BLOCK immediately!
                    Ok(ConnectionTestResult {
                        success: false,
                        server_id: server.id.clone(),
                        server_name: server.name.clone(),
                        hostname: target_host,
                        port,
                        username: username.clone(),
                        host_key: Some(host_key),
                        host_key_status: "CHANGED_WARNING".into(),
                        previous_fingerprint: Some(previous_fingerprint),
                        new_fingerprint: Some(new_fingerprint),
                        latency_ms,
                        server_version_banner: None,
                        error_message: Some(
                            "CRITICAL SECURITY WARNING: Remote host identification has changed! Possible man-in-the-middle attack or server rebuild.".into(),
                        ),
                    })
                }
                HostKeyStatus::NewHost { host_key: hk } => Ok(ConnectionTestResult {
                    success: true,
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    hostname: target_host,
                    port,
                    username: username.clone(),
                    host_key: Some(hk.clone()),
                    host_key_status: "NEW_HOST".into(),
                    previous_fingerprint: None,
                    new_fingerprint: Some(hk.fingerprint_sha256),
                    latency_ms,
                    server_version_banner: Some("SSH-2.0-OpenSSH_Ready".into()),
                    error_message: None,
                }),
                HostKeyStatus::Trusted => Ok(ConnectionTestResult {
                    success: true,
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    hostname: target_host,
                    port,
                    username: username.clone(),
                    host_key: Some(host_key),
                    host_key_status: "TRUSTED".into(),
                    previous_fingerprint: None,
                    new_fingerprint: None,
                    latency_ms,
                    server_version_banner: Some("SSH-2.0-OpenSSH_Ready".into()),
                    error_message: None,
                }),
                HostKeyStatus::Revoked => Ok(ConnectionTestResult {
                    success: false,
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    hostname: target_host,
                    port,
                    username: username.clone(),
                    host_key: Some(host_key),
                    host_key_status: "REVOKED".into(),
                    previous_fingerprint: None,
                    new_fingerprint: None,
                    latency_ms,
                    server_version_banner: None,
                    error_message: Some("The remote host key has been explicitly REVOKED.".into()),
                }),
            }
        })
    }
}

// --- Mock SSH Transport for Deterministic Testing & CI ---

pub struct MockSshTransport {
    mock_keys: Mutex<HashMap<(String, u16), HostKeyInfo>>,
    should_fail: Mutex<bool>,
}

impl MockSshTransport {
    pub fn new() -> Self {
        Self {
            mock_keys: Mutex::new(HashMap::new()),
            should_fail: Mutex::new(false),
        }
    }

    pub fn register_host_key(&self, hostname: &str, port: u16, key: HostKeyInfo) {
        let mut keys = self.mock_keys.lock().unwrap();
        keys.insert((hostname.to_string(), port), key);
    }

    pub fn set_fail(&self, fail: bool) {
        let mut f = self.should_fail.lock().unwrap();
        *f = fail;
    }
}

impl Default for MockSshTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl SshTransport for MockSshTransport {
    fn fetch_host_key<'a>(
        &'a self,
        hostname: &'a str,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<HostKeyInfo, AppError>> + Send + 'a>> {
        Box::pin(async move {
            if *self.should_fail.lock().unwrap() {
                return Err(AppError::ExecutionFailed(format!(
                    "Connection timed out connecting to {}:{}",
                    hostname, port
                )));
            }

            let keys = self.mock_keys.lock().unwrap();
            if let Some(key) = keys.get(&(hostname.to_string(), port)) {
                Ok(key.clone())
            } else {
                // Default generated mock host key for unregistered hosts
                Ok(HostKeyInfo {
                    key_type: "ssh-ed25519".into(),
                    public_key_base64:
                        "AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z3m"
                            .into(),
                    fingerprint_sha256: "SHA256:4t7XhE69e1PZ8j/0dGvKk3n1m7o9p5q8r2s4t6u8v0w".into(),
                })
            }
        })
    }

    fn test_connection<'a>(
        &'a self,
        server: &'a ServerRecord,
        known_hosts: &'a mut KnownHostsManager,
        _secret_override: Option<&'a str>,
    ) -> Pin<Box<dyn Future<Output = Result<ConnectionTestResult, AppError>> + Send + 'a>> {
        Box::pin(async move {
            if *self.should_fail.lock().unwrap() {
                return Ok(ConnectionTestResult {
                    success: false,
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    hostname: server.hostname.clone(),
                    port: server.port,
                    username: server.username.clone(),
                    host_key: None,
                    host_key_status: "UNVERIFIED".into(),
                    previous_fingerprint: None,
                    new_fingerprint: None,
                    latency_ms: 5000,
                    server_version_banner: None,
                    error_message: Some("Connection timed out after 5000ms".into()),
                });
            }

            let host_key = self.fetch_host_key(&server.hostname, server.port).await?;
            let verification =
                known_hosts.verify_host_key(&server.hostname, server.port, &host_key);

            match verification {
                HostKeyStatus::ChangedWarning {
                    previous_fingerprint,
                    new_fingerprint,
                    ..
                } => Ok(ConnectionTestResult {
                    success: false,
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    hostname: server.hostname.clone(),
                    port: server.port,
                    username: server.username.clone(),
                    host_key: Some(host_key),
                    host_key_status: "CHANGED_WARNING".into(),
                    previous_fingerprint: Some(previous_fingerprint),
                    new_fingerprint: Some(new_fingerprint),
                    latency_ms: 15,
                    server_version_banner: None,
                    error_message: Some(
                        "HOST KEY CHANGED WARNING: Potential Man-in-the-middle attack.".into(),
                    ),
                }),
                HostKeyStatus::NewHost { host_key: hk } => Ok(ConnectionTestResult {
                    success: true,
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    hostname: server.hostname.clone(),
                    port: server.port,
                    username: server.username.clone(),
                    host_key: Some(hk.clone()),
                    host_key_status: "NEW_HOST".into(),
                    previous_fingerprint: None,
                    new_fingerprint: Some(hk.fingerprint_sha256),
                    latency_ms: 18,
                    server_version_banner: Some("SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3".into()),
                    error_message: None,
                }),
                HostKeyStatus::Trusted => Ok(ConnectionTestResult {
                    success: true,
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    hostname: server.hostname.clone(),
                    port: server.port,
                    username: server.username.clone(),
                    host_key: Some(host_key),
                    host_key_status: "TRUSTED".into(),
                    previous_fingerprint: None,
                    new_fingerprint: None,
                    latency_ms: 14,
                    server_version_banner: Some("SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3".into()),
                    error_message: None,
                }),
                HostKeyStatus::Revoked => Ok(ConnectionTestResult {
                    success: false,
                    server_id: server.id.clone(),
                    server_name: server.name.clone(),
                    hostname: server.hostname.clone(),
                    port: server.port,
                    username: server.username.clone(),
                    host_key: Some(host_key),
                    host_key_status: "REVOKED".into(),
                    previous_fingerprint: None,
                    new_fingerprint: None,
                    latency_ms: 10,
                    server_version_banner: None,
                    error_message: Some("Host key is revoked".into()),
                }),
            }
        })
    }
}
