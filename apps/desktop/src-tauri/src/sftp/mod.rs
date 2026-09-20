//! Remote File Management & SFTP Runtime
//! Master Spec §0.2, §11 (M8): Remote File Management (WinSCP-style browsing, safe editing, transfers).

use crate::database::Database;
use crate::error::AppError;
use crate::models::ServerRecord;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size_bytes: u64,
    pub modified_at: String,
    pub permissions_mode: String, // e.g. "0644", "0755"
    pub owner: Option<String>,
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileContentResult {
    pub path: String,
    pub content: String,
    pub is_truncated: bool,
    pub total_bytes: u64,
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileWriteResult {
    pub path: String,
    pub bytes_written: usize,
    pub backup_path: Option<String>,
}

#[derive(Clone)]
struct VirtualFile {
    is_dir: bool,
    content: Option<String>,
    size_bytes: u64,
    modified_at: String,
    permissions_mode: String,
    owner: String,
    group: String,
}

pub struct SftpManager {
    virtual_fs: Arc<Mutex<HashMap<String, HashMap<String, VirtualFile>>>>,
}

impl Default for SftpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SftpManager {
    pub fn new() -> Self {
        let manager = Self {
            virtual_fs: Arc::new(Mutex::new(HashMap::new())),
        };
        manager.seed_mock_server("production01");
        manager.seed_mock_server("srv-prod-cpanel-01");
        manager
    }

    fn seed_mock_server(&self, server_id: &str) {
        let mut fs = HashMap::new();
        let now = Utc::now().to_rfc3339();

        let dirs = [
            "/",
            "/bin",
            "/etc",
            "/etc/nginx",
            "/home",
            "/home/deploy",
            "/var",
            "/var/log",
            "/var/log/nginx",
            "/var/www",
            "/var/www/html",
            "/tmp",
        ];

        for d in dirs {
            fs.insert(
                d.to_string(),
                VirtualFile {
                    is_dir: true,
                    content: None,
                    size_bytes: 4096,
                    modified_at: now.clone(),
                    permissions_mode: "0755".into(),
                    owner: "root".into(),
                    group: "root".into(),
                },
            );
        }

        let files = [
            (
                "/etc/hosts",
                "127.0.0.1 localhost\n127.0.1.1 production01\n198.51.100.15 production01.internal\n",
                "0644",
                "root",
            ),
            (
                "/etc/os-release",
                "NAME=\"Ubuntu\"\nVERSION=\"22.04.4 LTS (Jammy Jellyfish)\"\nID=ubuntu\nPRETTY_NAME=\"Ubuntu 22.04.4 LTS\"\n",
                "0644",
                "root",
            ),
            (
                "/etc/nginx/nginx.conf",
                "# Nginx Configuration\nuser www-data;\nworker_processes auto;\nevents {\n    worker_connections 1024;\n}\nhttp {\n    server {\n        listen 80;\n        server_name production01.example.com;\n        root /var/www/html;\n        index index.html;\n    }\n}\n",
                "0644",
                "root",
            ),
            (
                "/var/www/html/index.html",
                "<!DOCTYPE html>\n<html>\n<head><title>Production 01</title></head>\n<body><h1>RemoteCommander Operations Host</h1><p>System status: Operational.</p></body>\n</html>\n",
                "0644",
                "www-data",
            ),
            (
                "/var/www/html/wp-config.php",
                "<?php\n/** WordPress configuration for production01 */\ndefine('DB_NAME', 'prod_wordpress');\ndefine('DB_USER', 'wp_dbuser');\ndefine('DB_PASSWORD', 'SECRET_REDACTED_PASSWORD');\ndefine('DB_HOST', 'localhost');\ndefine('WP_DEBUG', false);\n",
                "0600",
                "www-data",
            ),
            (
                "/var/www/html/.env",
                "APP_ENV=production\nAPP_DEBUG=false\nAPP_KEY=base64:mockedProductionAppKey1234567890=\nPORT=8080\n",
                "0600",
                "www-data",
            ),
            (
                "/var/log/nginx/access.log",
                "192.168.1.50 - - [10/Jan/2026:12:00:01 +0000] \"GET / HTTP/1.1\" 200 612 \"-\" \"Mozilla/5.0\"\n192.168.1.51 - - [10/Jan/2026:12:00:05 +0000] \"GET /health HTTP/1.1\" 200 15 \"-\" \"HealthChecker/1.0\"\n",
                "0644",
                "www-data",
            ),
            (
                "/home/deploy/.bashrc",
                "# ~/.bashrc: executed by bash for non-login shells.\nexport PATH=$PATH:/usr/local/bin\nalias ll='ls -la'\n",
                "0644",
                "deploy",
            ),
        ];

        for (path, content, mode, owner) in files {
            fs.insert(
                path.to_string(),
                VirtualFile {
                    is_dir: false,
                    content: Some(content.to_string()),
                    size_bytes: content.len() as u64,
                    modified_at: now.clone(),
                    permissions_mode: mode.into(),
                    owner: owner.into(),
                    group: owner.into(),
                },
            );
        }

        let mut lock = self.virtual_fs.lock().unwrap();
        lock.insert(server_id.to_string(), fs);
    }

    fn is_mock_server(&self, db: Option<&Database>, server_id: &str) -> bool {
        if server_id == "production01"
            || server_id == "srv-prod-cpanel-01"
            || server_id.starts_with("mock-")
            || server_id.starts_with("test-")
            || std::env::var("REMOTE_COMMANDER_MOCK_SFTP").is_ok()
        {
            return true;
        }

        if let Some(database) = db {
            if let Ok(Some(server)) = database.get_server(server_id) {
                return server.hostname == "production01"
                    || server.hostname == "127.0.0.1"
                    || server.hostname == "localhost"
                    || server.hostname == "198.51.100.15"
                    || server.hostname.starts_with("mock-")
                    || server.hostname.starts_with("test-")
                    || server.name.to_lowercase().contains("mock")
                    || server.name.to_lowercase().contains("test");
            }
        }
        false
    }

    /// List directory contents on target server
    pub fn list_directory(
        &self,
        db: Option<&Database>,
        server_id: &str,
        path: &str,
        show_hidden: bool,
    ) -> Result<Vec<RemoteFileEntry>, AppError> {
        let normalized = normalize_path(path);

        if self.is_mock_server(db, server_id) {
            let lock = self.virtual_fs.lock().unwrap();
            let fs = lock.get(server_id).or_else(|| lock.get("production01"));

            if let Some(files) = fs {
                let mut entries = Vec::new();
                let prefix = if normalized == "/" {
                    "/".to_string()
                } else {
                    format!("{}/", normalized)
                };

                for (f_path, f_meta) in files.iter() {
                    if f_path == &normalized {
                        continue;
                    }

                    if f_path.starts_with(&prefix) {
                        let remainder = &f_path[prefix.len()..];
                        // Only immediate children (no subsequent slash)
                        if !remainder.is_empty() && !remainder.contains('/') {
                            if !show_hidden && remainder.starts_with('.') {
                                continue;
                            }

                            entries.push(RemoteFileEntry {
                                name: remainder.to_string(),
                                path: f_path.clone(),
                                is_dir: f_meta.is_dir,
                                is_symlink: false,
                                size_bytes: f_meta.size_bytes,
                                modified_at: f_meta.modified_at.clone(),
                                permissions_mode: f_meta.permissions_mode.clone(),
                                owner: Some(f_meta.owner.clone()),
                                group: Some(f_meta.group.clone()),
                            });
                        }
                    }
                }

                entries.sort_by(|a, b| {
                    if a.is_dir != b.is_dir {
                        b.is_dir.cmp(&a.is_dir) // Directories first
                    } else {
                        a.name.cmp(&b.name)
                    }
                });

                return Ok(entries);
            }
        }

        // Live OpenSSH execution
        let target_server = resolve_server(db, server_id)?;
        let cmd = format!(
            "ls -la --time-style=full-iso {} 2>/dev/null || ls -la {}",
            escape_shell_arg(&normalized),
            escape_shell_arg(&normalized)
        );

        let output = execute_ssh_command(&target_server, &cmd)?;
        parse_ls_output(&output.stdout.unwrap_or_default(), &normalized, show_hidden)
    }

    /// Read file content with safety boundaries and truncation
    pub fn read_file(
        &self,
        db: Option<&Database>,
        server_id: &str,
        path: &str,
        max_bytes: Option<usize>,
    ) -> Result<FileContentResult, AppError> {
        let normalized = normalize_path(path);
        let max_limit = max_bytes.unwrap_or(100_000);

        if self.is_mock_server(db, server_id) {
            let lock = self.virtual_fs.lock().unwrap();
            let fs = lock.get(server_id).or_else(|| lock.get("production01"));

            if let Some(files) = fs {
                if let Some(file) = files.get(&normalized) {
                    if file.is_dir {
                        return Err(AppError::Validation(format!(
                            "'{}' is a directory, not a file",
                            normalized
                        )));
                    }

                    let raw_content = file.content.clone().unwrap_or_default();
                    let total_bytes = raw_content.len() as u64;

                    let (content, is_truncated) = if raw_content.len() > max_limit {
                        let mut truncated = raw_content[..max_limit].to_string();
                        truncated.push_str("\n\n[FILE TRUNCATED AT 100,000 BYTES]");
                        (truncated, true)
                    } else {
                        (raw_content, false)
                    };

                    return Ok(FileContentResult {
                        path: normalized,
                        content,
                        is_truncated,
                        total_bytes,
                        encoding: "utf-8".into(),
                    });
                }
            }
            return Err(AppError::NotFound(format!(
                "File '{}' not found on server",
                normalized
            )));
        }

        // Live OpenSSH read
        let target_server = resolve_server(db, server_id)?;
        let cmd = format!("cat {}", escape_shell_arg(&normalized));
        let output = execute_ssh_command(&target_server, &cmd)?;

        if !output.success {
            return Err(AppError::ExecutionFailed(
                output
                    .stderr
                    .unwrap_or_else(|| "Failed to read remote file".into()),
            ));
        }

        let raw = output.stdout.unwrap_or_default();
        let total_bytes = raw.len() as u64;

        let (content, is_truncated) = if raw.len() > max_limit {
            let mut truncated = raw[..max_limit].to_string();
            truncated.push_str("\n\n[FILE TRUNCATED AT 100,000 BYTES]");
            (truncated, true)
        } else {
            (raw, false)
        };

        Ok(FileContentResult {
            path: normalized,
            content,
            is_truncated,
            total_bytes,
            encoding: "utf-8".into(),
        })
    }

    /// Safely write or patch file with automatic backup creation
    pub fn write_file(
        &self,
        db: Option<&Database>,
        server_id: &str,
        path: &str,
        content: &str,
        create_backup: bool,
    ) -> Result<FileWriteResult, AppError> {
        let normalized = normalize_path(path);
        let now = Utc::now().to_rfc3339();

        if self.is_mock_server(db, server_id) {
            let mut lock = self.virtual_fs.lock().unwrap();
            let fs = lock.entry(server_id.to_string()).or_default();

            let mut backup_path = None;
            if create_backup {
                if let Some(existing) = fs.get(&normalized) {
                    if let Some(ref old_content) = existing.content {
                        let b_path = format!("{}.bak.{}", normalized, Utc::now().timestamp());
                        fs.insert(
                            b_path.clone(),
                            VirtualFile {
                                is_dir: false,
                                content: Some(old_content.clone()),
                                size_bytes: old_content.len() as u64,
                                modified_at: now.clone(),
                                permissions_mode: existing.permissions_mode.clone(),
                                owner: existing.owner.clone(),
                                group: existing.group.clone(),
                            },
                        );
                        backup_path = Some(b_path);
                    }
                }
            }

            fs.insert(
                normalized.clone(),
                VirtualFile {
                    is_dir: false,
                    content: Some(content.to_string()),
                    size_bytes: content.len() as u64,
                    modified_at: now,
                    permissions_mode: "0644".into(),
                    owner: "root".into(),
                    group: "root".into(),
                },
            );

            return Ok(FileWriteResult {
                path: normalized,
                bytes_written: content.len(),
                backup_path,
            });
        }

        // Live OpenSSH write with safe backup
        let target_server = resolve_server(db, server_id)?;
        let mut backup_path = None;

        if create_backup {
            let b_path = format!("{}.bak.{}", normalized, Utc::now().timestamp());
            let cp_cmd = format!(
                "test -f {} && cp {} {}",
                escape_shell_arg(&normalized),
                escape_shell_arg(&normalized),
                escape_shell_arg(&b_path)
            );
            let cp_out = execute_ssh_command(&target_server, &cp_cmd)?;
            if cp_out.success {
                backup_path = Some(b_path);
            }
        }

        let write_cmd = format!(
            "cat << 'REMOTE_COMMANDER_EOF' > {}\n{}\nREMOTE_COMMANDER_EOF",
            escape_shell_arg(&normalized),
            content
        );

        let write_out = execute_ssh_command(&target_server, &write_cmd)?;
        if !write_out.success {
            return Err(AppError::ExecutionFailed(
                write_out
                    .stderr
                    .unwrap_or_else(|| "Failed to write remote file".into()),
            ));
        }

        Ok(FileWriteResult {
            path: normalized,
            bytes_written: content.len(),
            backup_path,
        })
    }

    /// Get file stat metadata
    pub fn file_info(
        &self,
        db: Option<&Database>,
        server_id: &str,
        path: &str,
    ) -> Result<RemoteFileEntry, AppError> {
        let normalized = normalize_path(path);

        if self.is_mock_server(db, server_id) {
            let lock = self.virtual_fs.lock().unwrap();
            let fs = lock.get(server_id).or_else(|| lock.get("production01"));

            if let Some(files) = fs {
                if let Some(file) = files.get(&normalized) {
                    let name = normalized
                        .split('/')
                        .next_back()
                        .unwrap_or("unknown")
                        .to_string();
                    return Ok(RemoteFileEntry {
                        name,
                        path: normalized,
                        is_dir: file.is_dir,
                        is_symlink: false,
                        size_bytes: file.size_bytes,
                        modified_at: file.modified_at.clone(),
                        permissions_mode: file.permissions_mode.clone(),
                        owner: Some(file.owner.clone()),
                        group: Some(file.group.clone()),
                    });
                }
            }
            return Err(AppError::NotFound(format!(
                "File '{}' not found",
                normalized
            )));
        }

        // Live OpenSSH stat
        let target_server = resolve_server(db, server_id)?;
        let cmd = format!(
            "stat -c '%n|%s|%F|%a|%U|%G|%y' {}",
            escape_shell_arg(&normalized)
        );
        let output = execute_ssh_command(&target_server, &cmd)?;
        let stdout = output.stdout.unwrap_or_default();
        let parts: Vec<&str> = stdout.trim().split('|').collect();

        if parts.len() >= 6 {
            let name = normalized.split('/').next_back().unwrap_or("").to_string();
            let size = parts[1].parse::<u64>().unwrap_or(0);
            let is_dir = parts[2].contains("directory");
            let mode = parts[3].to_string();
            let owner = parts[4].to_string();
            let group = parts[5].to_string();
            let modified = if parts.len() > 6 {
                parts[6].to_string()
            } else {
                Utc::now().to_rfc3339()
            };

            return Ok(RemoteFileEntry {
                name,
                path: normalized,
                is_dir,
                is_symlink: false,
                size_bytes: size,
                modified_at: modified,
                permissions_mode: mode,
                owner: Some(owner),
                group: Some(group),
            });
        }

        Err(AppError::NotFound(format!(
            "Could not stat '{}'",
            normalized
        )))
    }

    /// Delete file or directory
    pub fn delete_file(
        &self,
        db: Option<&Database>,
        server_id: &str,
        path: &str,
    ) -> Result<(), AppError> {
        let normalized = normalize_path(path);

        if self.is_mock_server(db, server_id) {
            let mut lock = self.virtual_fs.lock().unwrap();
            if let Some(fs) = lock.get_mut(server_id) {
                if fs.remove(&normalized).is_some() {
                    return Ok(());
                }
            }
            return Err(AppError::NotFound(format!(
                "File '{}' not found",
                normalized
            )));
        }

        let target_server = resolve_server(db, server_id)?;
        let cmd = format!("rm -rf {}", escape_shell_arg(&normalized));
        let output = execute_ssh_command(&target_server, &cmd)?;
        if !output.success {
            return Err(AppError::ExecutionFailed(
                output
                    .stderr
                    .unwrap_or_else(|| "Failed to delete file".into()),
            ));
        }
        Ok(())
    }

    /// Create new directory
    pub fn create_directory(
        &self,
        db: Option<&Database>,
        server_id: &str,
        path: &str,
    ) -> Result<(), AppError> {
        let normalized = normalize_path(path);
        let now = Utc::now().to_rfc3339();

        if self.is_mock_server(db, server_id) {
            let mut lock = self.virtual_fs.lock().unwrap();
            let fs = lock.entry(server_id.to_string()).or_default();

            fs.insert(
                normalized,
                VirtualFile {
                    is_dir: true,
                    content: None,
                    size_bytes: 4096,
                    modified_at: now,
                    permissions_mode: "0755".into(),
                    owner: "root".into(),
                    group: "root".into(),
                },
            );
            return Ok(());
        }

        let target_server = resolve_server(db, server_id)?;
        let cmd = format!("mkdir -p {}", escape_shell_arg(&normalized));
        let output = execute_ssh_command(&target_server, &cmd)?;
        if !output.success {
            return Err(AppError::ExecutionFailed(
                output
                    .stderr
                    .unwrap_or_else(|| "Failed to create directory".into()),
            ));
        }
        Ok(())
    }
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return "/".to_string();
    }
    let p = trimmed.replace('\\', "/");
    let mut normalized = if !p.starts_with('/') {
        format!("/{}", p)
    } else {
        p
    };
    if normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

fn escape_shell_arg(arg: &str) -> String {
    format!("'{}'", arg.replace('\'', "'\\''"))
}

fn resolve_server(db: Option<&Database>, server_id: &str) -> Result<ServerRecord, AppError> {
    if let Some(database) = db {
        if let Some(server) = database.get_server(server_id)? {
            return Ok(server);
        }
    }
    Err(AppError::NotFound(format!(
        "Server '{}' not found",
        server_id
    )))
}

struct SshCommandOutput {
    success: bool,
    stdout: Option<String>,
    stderr: Option<String>,
}

fn execute_ssh_command(server: &ServerRecord, cmd: &str) -> Result<SshCommandOutput, AppError> {
    let target_host = if let Some(alias) = &server.ssh_config_alias {
        if let Some(resolved) = crate::ssh::ssh_config::resolve_alias(alias) {
            resolved.hostname
        } else {
            server.hostname.clone()
        }
    } else {
        server.hostname.clone()
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
        .arg(server.port.to_string())
        .arg(format!("{}@{}", server.username, target_host))
        .arg(cmd);

    let output = ssh_cmd
        .output()
        .map_err(|e| AppError::ExecutionFailed(format!("Failed to execute ssh command: {}", e)))?;

    Ok(SshCommandOutput {
        success: output.status.success(),
        stdout: Some(String::from_utf8_lossy(&output.stdout).to_string()),
        stderr: Some(String::from_utf8_lossy(&output.stderr).to_string()),
    })
}

fn parse_ls_output(
    raw: &str,
    parent_path: &str,
    show_hidden: bool,
) -> Result<Vec<RemoteFileEntry>, AppError> {
    let mut entries = Vec::new();
    let parent = if parent_path == "/" {
        "".to_string()
    } else {
        parent_path.to_string()
    };

    for line in raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 || line.starts_with("total") {
            continue;
        }

        let perms = parts[0];
        let owner = parts[2];
        let group = parts[3];
        let size = parts[4].parse::<u64>().unwrap_or(0);
        let name = parts[8..].join(" ");

        if name == "." || name == ".." {
            continue;
        }

        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let is_dir = perms.starts_with('d');
        let is_symlink = perms.starts_with('l');
        let path = format!("{}/{}", parent, name);

        entries.push(RemoteFileEntry {
            name,
            path,
            is_dir,
            is_symlink,
            size_bytes: size,
            modified_at: parts[5..8].join(" "),
            permissions_mode: perms.to_string(),
            owner: Some(owner.to_string()),
            group: Some(group.to_string()),
        });
    }

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_directory_mock() {
        let manager = SftpManager::new();
        let entries = manager
            .list_directory(None, "production01", "/etc", false)
            .expect("Should list /etc");

        assert!(!entries.is_empty());
        let hosts_entry = entries.iter().find(|e| e.name == "hosts");
        assert!(hosts_entry.is_some());
        assert!(!hosts_entry.unwrap().is_dir);

        let nginx_dir = entries.iter().find(|e| e.name == "nginx");
        assert!(nginx_dir.is_some());
        assert!(nginx_dir.unwrap().is_dir);
    }

    #[test]
    fn test_read_file_mock() {
        let manager = SftpManager::new();
        let file = manager
            .read_file(None, "production01", "/etc/hosts", None)
            .expect("Should read /etc/hosts");

        assert_eq!(file.path, "/etc/hosts");
        assert!(file.content.contains("localhost"));
        assert!(!file.is_truncated);
    }

    #[test]
    fn test_write_file_with_backup_mock() {
        let manager = SftpManager::new();
        let new_content = "# Updated Nginx config\nworker_processes 4;\n";

        let write_res = manager
            .write_file(
                None,
                "production01",
                "/etc/nginx/nginx.conf",
                new_content,
                true,
            )
            .expect("Should write file");

        assert_eq!(write_res.bytes_written, new_content.len());
        assert!(write_res.backup_path.is_some());
        let b_path = write_res.backup_path.unwrap();
        assert!(b_path.contains("/etc/nginx/nginx.conf.bak."));

        // Verify updated content
        let read = manager
            .read_file(None, "production01", "/etc/nginx/nginx.conf", None)
            .unwrap();
        assert_eq!(read.content, new_content);

        // Verify backup content exists and holds original
        let read_bak = manager
            .read_file(None, "production01", &b_path, None)
            .unwrap();
        assert!(read_bak.content.contains("worker_connections 1024;"));
    }

    #[test]
    fn test_file_info_stat_mock() {
        let manager = SftpManager::new();
        let info = manager
            .file_info(None, "production01", "/var/www/html/index.html")
            .expect("Should get file info");

        assert_eq!(info.name, "index.html");
        assert_eq!(info.path, "/var/www/html/index.html");
        assert!(!info.is_dir);
        assert_eq!(info.permissions_mode, "0644");
        assert_eq!(info.owner, Some("www-data".into()));
    }

    #[test]
    fn test_delete_file_mock() {
        let manager = SftpManager::new();
        manager
            .delete_file(None, "production01", "/var/www/html/.env")
            .expect("Should delete file");

        let read_res = manager.read_file(None, "production01", "/var/www/html/.env", None);
        assert!(read_res.is_err());
    }

    #[test]
    fn test_create_directory_mock() {
        let manager = SftpManager::new();
        manager
            .create_directory(None, "production01", "/var/www/html/uploads")
            .expect("Should create directory");

        let entries = manager
            .list_directory(None, "production01", "/var/www/html", false)
            .unwrap();
        let found = entries.iter().find(|e| e.name == "uploads");
        assert!(found.is_some());
        assert!(found.unwrap().is_dir);
    }
}
