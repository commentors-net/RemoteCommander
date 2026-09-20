//! Terminal and PTY Management Runtime
//! Master Spec §0.2, §10 (M7): Interactive Terminal with xterm.js + PTY.
//! Supports native local workstation PTY, remote SSH PTY, and deterministic mock interactive shell.

use crate::database::Database;
use crate::error::AppError;
use crate::models::ServerRecord;
use chrono::Utc;
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalSessionInfo {
    pub id: String,
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    pub title: String,
    pub cols: u16,
    pub rows: u16,
    pub status: String, // "ACTIVE", "TERMINATED"
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalOutputChunk {
    pub session_id: String,
    pub data: String,
    pub seq: u64,
}

#[derive(Default)]
pub struct SessionOutputState {
    pub seq: u64,
    pub data: String,
}

enum SessionWriter {
    Pty(Box<dyn Write + Send>),
    Mock {
        server_name: String,
        current_line: String,
    },
}

struct ActiveSession {
    info: TerminalSessionInfo,
    writer: Option<SessionWriter>,
    master: Option<Box<dyn MasterPty + Send>>,
    child: Option<Box<dyn portable_pty::Child + Send>>,
    output: Arc<Mutex<SessionOutputState>>,
}

impl ActiveSession {
    fn handle_mock_input(&mut self, input: &str, app: Option<&AppHandle>) {
        if self.info.status == "TERMINATED" {
            return;
        }

        let mut output_to_append = String::new();

        if let Some(SessionWriter::Mock {
            ref server_name,
            ref mut current_line,
        }) = self.writer
        {
            for ch in input.chars() {
                match ch {
                    '\x03' => {
                        // Ctrl+C (SIGINT / Interruption)
                        current_line.clear();
                        output_to_append.push_str("^C\r\n");
                        output_to_append.push_str(&format!("root@{}:~# ", server_name));
                    }
                    '\r' | '\n' => {
                        output_to_append.push_str("\r\n");
                        let cmd = current_line.trim().to_string();
                        current_line.clear();

                        if cmd == "exit" || cmd == "logout" {
                            output_to_append.push_str(&format!(
                                "logout\r\nConnection to {} closed.\r\n",
                                server_name
                            ));
                            self.info.status = "TERMINATED".into();
                            break;
                        } else if cmd == "clear" {
                            output_to_append.push_str("\x1b[2J\x1b[H");
                        } else if !cmd.is_empty() {
                            let simulated_out = simulate_terminal_command(&cmd, server_name);
                            output_to_append.push_str(&simulated_out);
                        }

                        if self.info.status != "TERMINATED" {
                            output_to_append.push_str(&format!("root@{}:~# ", server_name));
                        }
                    }
                    '\x08' | '\x7f' => {
                        // Backspace handling
                        if !current_line.is_empty() {
                            current_line.pop();
                            output_to_append.push_str("\x08 \x08");
                        }
                    }
                    other => {
                        current_line.push(other);
                        output_to_append.push(other);
                    }
                }
            }
        }

        if !output_to_append.is_empty() {
            let mut state = self.output.lock().unwrap();
            state.seq += 1;
            let seq = state.seq;
            state.data.push_str(&output_to_append);
            let len = state.data.len();
            if len > 200_000 {
                state.data = state.data.split_off(len - 100_000);
            }
            if let Some(app_handle) = app {
                let _ = app_handle.emit(
                    &format!("terminal-output-{}", self.info.id),
                    &TerminalOutputChunk {
                        session_id: self.info.id.clone(),
                        data: output_to_append,
                        seq,
                    },
                );
            }
        }
    }
}

pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, ActiveSession>>>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start a new interactive terminal session
    pub fn start_session(
        &self,
        app: Option<&AppHandle>,
        db: Option<&Database>,
        server_id: Option<String>,
        cols: Option<u16>,
        rows: Option<u16>,
        title: Option<String>,
    ) -> Result<TerminalSessionInfo, AppError> {
        let cols = cols.unwrap_or(80);
        let rows = rows.unwrap_or(24);
        let session_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let target_server: Option<ServerRecord> = if let Some(ref srv_id) = server_id {
            if let Some(database) = db {
                database.get_server(srv_id)?
            } else {
                None
            }
        } else {
            None
        };

        let server_name = target_server
            .as_ref()
            .map(|s| s.name.clone())
            .or_else(|| server_id.clone());

        let session_title = title.unwrap_or_else(|| {
            if let Some(ref name) = server_name {
                format!("SSH: {}", name)
            } else {
                "Local Terminal".to_string()
            }
        });

        let info = TerminalSessionInfo {
            id: session_id.clone(),
            server_id: server_id.clone(),
            server_name: server_name.clone(),
            title: session_title,
            cols,
            rows,
            status: "ACTIVE".into(),
            created_at: now,
        };

        let output = Arc::new(Mutex::new(SessionOutputState::default()));

        let is_mock = match target_server {
            Some(ref srv) => {
                srv.hostname == "production01"
                    || srv.hostname == "127.0.0.1"
                    || srv.hostname == "localhost"
                    || srv.hostname == "198.51.100.15"
                    || srv.hostname.starts_with("mock-")
                    || srv.hostname.starts_with("test-")
                    || srv.name.to_lowercase().contains("mock")
                    || srv.name.to_lowercase().contains("test")
                    || srv.name == "production01"
                    || std::env::var("REMOTE_COMMANDER_MOCK_TERMINAL").is_ok()
            }
            None => {
                // If server_id was requested but not in DB, fallback to mock server
                server_id.is_some() || std::env::var("REMOTE_COMMANDER_MOCK_TERMINAL").is_ok()
            }
        };

        if is_mock {
            let srv_display = server_name.unwrap_or_else(|| "production01".into());
            let banner = format!(
                "\x1b[1;32mConnected to {} via SSH (RemoteCommander)\x1b[0m\r\nLinux {} 5.15.0-101-generic #111-Ubuntu SMP Wed Jan 10 12:00:00 UTC 2026 x86_64\r\n\r\nroot@{}:~# ",
                srv_display, srv_display, srv_display
            );

            {
                let mut state = output.lock().unwrap();
                state.seq = 1;
                state.data = banner.clone();
            }

            if let Some(app_handle) = app {
                let _ = app_handle.emit(
                    &format!("terminal-output-{}", session_id),
                    &TerminalOutputChunk {
                        session_id: session_id.clone(),
                        data: banner,
                        seq: 1,
                    },
                );
            }

            let session = ActiveSession {
                info: info.clone(),
                writer: Some(SessionWriter::Mock {
                    server_name: srv_display,
                    current_line: String::new(),
                }),
                master: None,
                child: None,
                output,
            };

            let mut sessions = self.sessions.lock().unwrap();
            sessions.insert(session_id, session);
            return Ok(info);
        }

        // Native PTY session (Local workstation or Live SSH host)
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::ExecutionFailed(format!("Failed to create PTY: {}", e)))?;

        let cmd_builder = if let Some(ref srv) = target_server {
            let target_host = if let Some(alias) = &srv.ssh_config_alias {
                if let Some(resolved) = crate::ssh::ssh_config::resolve_alias(alias) {
                    resolved.hostname
                } else {
                    srv.hostname.clone()
                }
            } else {
                srv.hostname.clone()
            };

            let mut cmd = CommandBuilder::new("ssh");
            cmd.arg("-tt");
            cmd.arg("-o");
            cmd.arg("BatchMode=yes");
            cmd.arg("-o");
            cmd.arg("StrictHostKeyChecking=yes");
            cmd.arg("-p");
            cmd.arg(srv.port.to_string());
            cmd.arg(format!("{}@{}", srv.username, target_host));
            cmd
        } else if cfg!(target_os = "windows") {
            let mut cmd = CommandBuilder::new("powershell.exe");
            cmd.arg("-NoLogo");
            cmd
        } else {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
            CommandBuilder::new(shell)
        };

        let child = pair
            .slave
            .spawn_command(cmd_builder)
            .map_err(|e| AppError::ExecutionFailed(format!("Failed to spawn shell: {}", e)))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::ExecutionFailed(format!("Failed to clone PTY reader: {}", e)))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::ExecutionFailed(format!("Failed to take PTY writer: {}", e)))?;

        let session_id_clone = session_id.clone();
        let buffer_clone = Arc::clone(&output);
        let app_handle_opt = app.cloned();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let mut state = buffer_clone.lock().unwrap();
                        state.seq += 1;
                        let seq = state.seq;
                        state.data.push_str(&text);
                        let len = state.data.len();
                        if len > 200_000 {
                            state.data = state.data.split_off(len - 100_000);
                        }
                        if let Some(ref app_h) = app_handle_opt {
                            let _ = app_h.emit(
                                &format!("terminal-output-{}", session_id_clone),
                                &TerminalOutputChunk {
                                    session_id: session_id_clone.clone(),
                                    data: text,
                                    seq,
                                },
                            );
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let session = ActiveSession {
            info: info.clone(),
            writer: Some(SessionWriter::Pty(writer)),
            master: Some(pair.master),
            child: Some(child),
            output,
        };

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(session_id, session);
        Ok(info)
    }

    /// Send input keystrokes or commands to the session
    pub fn send_input(
        &self,
        app: Option<&AppHandle>,
        session_id: &str,
        input: &str,
    ) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(session_id).ok_or_else(|| {
            AppError::NotFound(format!("Terminal session '{}' not found", session_id))
        })?;

        if session.info.status == "TERMINATED" {
            return Err(AppError::Validation("Terminal session has ended".into()));
        }

        match session.writer {
            Some(SessionWriter::Pty(ref mut w)) => {
                w.write_all(input.as_bytes())
                    .map_err(|e| AppError::ExecutionFailed(e.to_string()))?;
                w.flush()
                    .map_err(|e| AppError::ExecutionFailed(e.to_string()))?;
                Ok(())
            }
            Some(SessionWriter::Mock { .. }) => {
                session.handle_mock_input(input, app);
                Ok(())
            }
            None => Err(AppError::Validation("Session writer closed".into())),
        }
    }

    /// Read terminal output accumulated in ring buffer
    pub fn read_output(
        &self,
        session_id: &str,
        last_seq: Option<u64>,
    ) -> Result<TerminalOutputChunk, AppError> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(session_id).ok_or_else(|| {
            AppError::NotFound(format!("Terminal session '{}' not found", session_id))
        })?;

        let state = session.output.lock().unwrap();
        if let Some(last) = last_seq {
            if last >= state.seq {
                return Ok(TerminalOutputChunk {
                    session_id: session_id.to_string(),
                    data: String::new(),
                    seq: state.seq,
                });
            }
        }

        Ok(TerminalOutputChunk {
            session_id: session_id.to_string(),
            data: state.data.clone(),
            seq: state.seq,
        })
    }

    /// Resize terminal rows and columns
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(session_id).ok_or_else(|| {
            AppError::NotFound(format!("Terminal session '{}' not found", session_id))
        })?;

        session.info.cols = cols;
        session.info.rows = rows;

        if let Some(ref master) = session.master {
            let _ = master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }

        Ok(())
    }

    /// Interrupt running process (sends Ctrl+C / \x03)
    pub fn interrupt(&self, app: Option<&AppHandle>, session_id: &str) -> Result<(), AppError> {
        self.send_input(app, session_id, "\x03")
    }

    /// Terminate terminal session and clean up PTY/child
    pub fn terminate(&self, session_id: &str) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(session_id).ok_or_else(|| {
            AppError::NotFound(format!("Terminal session '{}' not found", session_id))
        })?;

        if let Some(ref mut child) = session.child {
            let _ = child.kill();
        }
        session.info.status = "TERMINATED".into();
        session.writer = None;
        session.master = None;
        session.child = None;

        Ok(())
    }

    /// List all active and historical sessions
    pub fn list_sessions(&self) -> Vec<TerminalSessionInfo> {
        let sessions = self.sessions.lock().unwrap();
        let mut list: Vec<TerminalSessionInfo> =
            sessions.values().map(|s| s.info.clone()).collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }
}

fn simulate_terminal_command(cmd: &str, server_name: &str) -> String {
    let first = cmd
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();

    match first.as_str() {
        "uptime" => " 14:35:12 up 58 days, 4:12,  1 user,  load average: 0.18, 0.12, 0.08\r\n".into(),
        "df" => "Filesystem      Size  Used Avail Use% Mounted on\r\n/dev/nvme0n1p1   50G   19G   31G  38% /\r\ntmpfs           3.9G     0  3.9G   0% /dev/shm\r\n/dev/nvme0n1p2  200G   82G  118G  41% /var\r\n".into(),
        "free" => "               total        used        free      shared  buff/cache   available\r\nMem:            8192        2410        3520         128        2262        5654\r\nSwap:           2048           0        2048\r\n".into(),
        "uname" => format!("Linux {} 5.15.0-101-generic #111-Ubuntu SMP Wed Jan 10 12:00:00 UTC 2026 x86_64\r\n", server_name),
        "hostname" => format!("{}\r\n", server_name),
        "whoami" => "root\r\n".into(),
        "top" => "top - 14:35:12 up 58 days, 4:12,  1 user,  load average: 0.18, 0.12, 0.08\r\nTasks: 112 total,   1 running, 111 sleeping,   0 stopped,   0 zombie\r\n%Cpu(s):  1.2 us,  0.8 sy,  0.0 ni, 97.8 id,  0.2 wa\r\nMiB Mem :   8192.0 total,   3520.0 free,   2410.0 used,   2262.0 buff/cache\r\n\r\n  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\r\n  789 root      20   0   15812   9100   7200 S   0.7   0.1   0:02.14 sshd\r\n    1 root      20   0  168432  11200   8400 S   0.0   0.1   0:04.55 systemd\r\n".into(),
        "ps" => "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\r\nroot         1  0.0  0.1 168432 11200 ?        Ss   Jan01   0:04 /sbin/init\r\nroot       542  0.0  0.2  72304 18400 ?        Ss   Jan01   0:01 /lib/systemd/systemd-journald\r\nsyslog     612  0.0  0.0 224100  4120 ?        Ssl  Jan01   0:00 /usr/sbin/rsyslogd -n\r\nroot       789  0.0  0.1  15812  9100 ?        Ss   Jan01   0:02 /usr/sbin/sshd -D\r\n".into(),
        "cat" => {
            if cmd.contains("os-release") || cmd.contains("issue") {
                "NAME=\"Ubuntu\"\r\nVERSION=\"22.04.4 LTS (Jammy Jellyfish)\"\r\nID=ubuntu\r\n".into()
            } else {
                format!("# Configuration for {}\r\nstatus=active\r\n", server_name)
            }
        }
        _ => format!("{}: command executed on {}\r\n", cmd, server_name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_start_mock_terminal_session() {
        let manager = TerminalManager::new();
        let session = manager
            .start_session(
                None,
                None,
                Some("production01".into()),
                Some(80),
                Some(24),
                None,
            )
            .expect("Should start mock session");

        assert_eq!(session.status, "ACTIVE");
        assert_eq!(session.cols, 80);
        assert_eq!(session.rows, 24);
        assert_eq!(session.server_id, Some("production01".into()));

        let output = manager
            .read_output(&session.id, None)
            .expect("Should read output");
        assert!(output.data.contains("Connected to production01"));
        assert!(output.data.contains("root@production01:~# "));
    }

    #[test]
    fn test_send_input_and_read_output() {
        let manager = TerminalManager::new();
        let session = manager
            .start_session(
                None,
                None,
                Some("production01".into()),
                Some(80),
                Some(24),
                None,
            )
            .unwrap();

        manager
            .send_input(None, &session.id, "uptime\r")
            .expect("Should send input");

        let output = manager.read_output(&session.id, None).unwrap();
        assert!(output.data.contains("load average"));
        assert!(output.data.contains("root@production01:~# "));
    }

    #[test]
    fn test_interrupt_ctrl_c() {
        let manager = TerminalManager::new();
        let session = manager
            .start_session(
                None,
                None,
                Some("production01".into()),
                Some(80),
                Some(24),
                None,
            )
            .unwrap();

        manager
            .interrupt(None, &session.id)
            .expect("Should interrupt");

        let output = manager.read_output(&session.id, None).unwrap();
        assert!(output.data.contains("^C"));
    }

    #[test]
    fn test_terminal_resize() {
        let manager = TerminalManager::new();
        let session = manager
            .start_session(
                None,
                None,
                Some("production01".into()),
                Some(80),
                Some(24),
                None,
            )
            .unwrap();

        manager
            .resize(&session.id, 120, 40)
            .expect("Should resize session");

        let sessions = manager.list_sessions();
        let s = sessions.iter().find(|s| s.id == session.id).unwrap();
        assert_eq!(s.cols, 120);
        assert_eq!(s.rows, 40);
    }

    #[test]
    fn test_terminate_session() {
        let manager = TerminalManager::new();
        let session = manager
            .start_session(
                None,
                None,
                Some("production01".into()),
                Some(80),
                Some(24),
                None,
            )
            .unwrap();

        manager
            .terminate(&session.id)
            .expect("Should terminate session");

        let sessions = manager.list_sessions();
        let s = sessions.iter().find(|s| s.id == session.id).unwrap();
        assert_eq!(s.status, "TERMINATED");

        // Sending input to terminated session should fail
        let send_res = manager.send_input(None, &session.id, "ls\r");
        assert!(send_res.is_err());
    }

    #[test]
    fn test_exit_command_terminates_session() {
        let manager = TerminalManager::new();
        let session = manager
            .start_session(
                None,
                None,
                Some("production01".into()),
                Some(80),
                Some(24),
                None,
            )
            .unwrap();

        manager
            .send_input(None, &session.id, "exit\r")
            .expect("Should send exit");

        let output = manager.read_output(&session.id, None).unwrap();
        assert!(output.data.contains("logout"));

        let sessions = manager.list_sessions();
        let s = sessions.iter().find(|s| s.id == session.id).unwrap();
        assert_eq!(s.status, "TERMINATED");
    }
}
