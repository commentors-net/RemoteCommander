/*!
 * Semantic Server Operations Engine (Milestone M10)
 * Authoritative baseline defined in Master Specification §13.
 * Supports cross-distro Linux operations: AlmaLinux, Rocky Linux, CloudLinux, Ubuntu, Debian.
 */

use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerSystemInfo {
    pub hostname: String,
    pub os_name: String,
    pub os_version: String,
    pub kernel: String,
    pub arch: String,
    pub uptime_seconds: u64,
    pub uptime_human: String,
    pub distro_family: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerDiskUsageEntry {
    pub filesystem: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub use_percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerMemoryUsage {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub shared_bytes: u64,
    pub buff_cache_bytes: u64,
    pub available_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub swap_free_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerCpuUsage {
    pub model_name: String,
    pub cores: u32,
    pub user_pct: f64,
    pub system_pct: f64,
    pub idle_pct: f64,
    pub iowait_pct: f64,
    pub steal_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerLoadAverage {
    pub load_1m: f64,
    pub load_5m: f64,
    pub load_15m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerProcessEntry {
    pub pid: u32,
    pub user: String,
    pub cpu_pct: f64,
    pub mem_pct: f64,
    pub status: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerNetworkConnection {
    pub proto: String,
    pub local_address: String,
    pub foreign_address: String,
    pub state: String,
    pub pid_program: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerServiceInfo {
    pub name: String,
    pub resolved_name: String,
    pub load_state: String,
    pub active_state: String,
    pub sub_state: String,
    pub main_pid: Option<u32>,
    pub description: Option<String>,
    pub is_running: bool,
    pub is_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServiceActionResult {
    pub service_name: String,
    pub resolved_name: String,
    pub action: String,
    pub success: bool,
    pub active_state_after: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerTailLogResult {
    pub path: String,
    pub lines: Vec<String>,
    pub total_lines: usize,
    pub truncated: bool,
}

/// Linux Service Name Adapter to bridge RHEL/AlmaLinux/CloudLinux vs Debian/Ubuntu naming conventions.
/// Distro Adapter providing Linux distro compatibility mappings across
/// AlmaLinux, Rocky Linux, CloudLinux, Ubuntu, and Debian (Master Spec §13, §20, §27).
pub struct DistroAdapter;

impl DistroAdapter {
    /// Checks whether the distro is in the Debian/Ubuntu family
    pub fn is_debian_family(distro_or_family: &str) -> bool {
        let clean = distro_or_family.trim().to_ascii_lowercase();
        clean.contains("debian") || clean.contains("ubuntu")
    }

    /// Resolves canonical package manager for the distro family
    pub fn resolve_package_manager(distro_or_family: &str) -> &'static str {
        if Self::is_debian_family(distro_or_family) {
            "apt"
        } else {
            "dnf"
        }
    }

    /// Resolves primary system log path
    pub fn resolve_syslog_path(distro_or_family: &str) -> &'static str {
        if Self::is_debian_family(distro_or_family) {
            "/var/log/syslog"
        } else {
            "/var/log/messages"
        }
    }

    /// Resolves primary web server error log path
    pub fn resolve_web_error_log(distro_or_family: &str) -> &'static str {
        if Self::is_debian_family(distro_or_family) {
            "/var/log/apache2/error.log"
        } else {
            "/var/log/httpd/error_log"
        }
    }
}

/// Linux Service Name Adapter to bridge RHEL/AlmaLinux/CloudLinux vs Debian/Ubuntu naming conventions.
pub struct ServiceAdapter;

impl ServiceAdapter {
    /// Resolves canonical service aliases to distro-specific systemd service units.
    pub fn resolve_service_name(alias_or_name: &str, distro_family: &str) -> String {
        let clean = alias_or_name
            .trim()
            .trim_end_matches(".service")
            .to_ascii_lowercase();
        let is_debian_family = DistroAdapter::is_debian_family(distro_family);

        match clean.as_str() {
            // Web Servers
            "apache" | "apache2" | "httpd" => {
                if is_debian_family {
                    "apache2".into()
                } else {
                    "httpd".into()
                }
            }
            // Database Servers
            "mysql" | "mysqld" | "mariadb" => {
                if is_debian_family {
                    "mysql".into()
                } else {
                    "mariadb".into()
                }
            }
            // Cron daemon
            "cron" | "crond" => {
                if is_debian_family {
                    "cron".into()
                } else {
                    "crond".into()
                }
            }
            // SSH server
            "ssh" | "sshd" => {
                if is_debian_family {
                    "ssh".into()
                } else {
                    "sshd".into()
                }
            }
            // Firewall
            "firewall" | "firewalld" | "ufw" => {
                if is_debian_family {
                    "ufw".into()
                } else {
                    "firewalld".into()
                }
            }
            // PHP-FPM generic
            "php-fpm" => {
                if is_debian_family {
                    "php8.2-fpm".into()
                } else {
                    "php-fpm".into()
                }
            }
            other => other.to_string(),
        }
    }
}

pub struct ServerOpsManager;

impl Default for ServerOpsManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerOpsManager {
    pub fn new() -> Self {
        Self
    }

    /// Parse `df -B1 -P` or standard POSIX `df` output into structured disk usage records.
    pub fn parse_df_output(stdout: &str) -> Vec<ServerDiskUsageEntry> {
        let mut entries = Vec::new();
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("Filesystem") {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 6 {
                let filesystem = parts[0].to_string();
                let total_bytes = parts[1].parse::<u64>().unwrap_or(0);
                let used_bytes = parts[2].parse::<u64>().unwrap_or(0);
                let available_bytes = parts[3].parse::<u64>().unwrap_or(0);
                let use_pct_str = parts[4].trim_end_matches('%');
                let use_percentage = use_pct_str.parse::<f64>().unwrap_or(0.0);
                let mount_point = parts[5].to_string();

                entries.push(ServerDiskUsageEntry {
                    filesystem,
                    mount_point,
                    total_bytes,
                    used_bytes,
                    available_bytes,
                    use_percentage,
                });
            }
        }
        entries
    }

    /// Parse `free -b` output into structured memory usage metrics.
    pub fn parse_free_output(stdout: &str) -> Result<ServerMemoryUsage, AppError> {
        let mut mem_total = 0u64;
        let mut mem_used = 0u64;
        let mut mem_free = 0u64;
        let mut mem_shared = 0u64;
        let mut mem_buff_cache = 0u64;
        let mut mem_available = 0u64;

        let mut swap_total = 0u64;
        let mut swap_used = 0u64;
        let mut swap_free = 0u64;

        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.is_empty() {
                continue;
            }
            if parts[0].starts_with("Mem:") && parts.len() >= 7 {
                mem_total = parts[1].parse().unwrap_or(0);
                mem_used = parts[2].parse().unwrap_or(0);
                mem_free = parts[3].parse().unwrap_or(0);
                mem_shared = parts[4].parse().unwrap_or(0);
                mem_buff_cache = parts[5].parse().unwrap_or(0);
                mem_available = parts[6].parse().unwrap_or(0);
            } else if parts[0].starts_with("Swap:") && parts.len() >= 4 {
                swap_total = parts[1].parse().unwrap_or(0);
                swap_used = parts[2].parse().unwrap_or(0);
                swap_free = parts[3].parse().unwrap_or(0);
            }
        }

        Ok(ServerMemoryUsage {
            total_bytes: mem_total,
            used_bytes: mem_used,
            free_bytes: mem_free,
            shared_bytes: mem_shared,
            buff_cache_bytes: mem_buff_cache,
            available_bytes: mem_available,
            swap_total_bytes: swap_total,
            swap_used_bytes: swap_used,
            swap_free_bytes: swap_free,
        })
    }

    /// Parse load average from `/proc/loadavg` or standard `uptime` output.
    pub fn parse_load_average(input: &str) -> Result<ServerLoadAverage, AppError> {
        // Direct /proc/loadavg format: "0.18 0.12 0.08 1/256 12345"
        let parts: Vec<&str> = input.split_whitespace().collect();
        if parts.len() >= 3 && parts[0].parse::<f64>().is_ok() {
            let l1 = parts[0].parse().unwrap_or(0.0);
            let l5 = parts[1].parse().unwrap_or(0.0);
            let l15 = parts[2].parse().unwrap_or(0.0);
            return Ok(ServerLoadAverage {
                load_1m: l1,
                load_5m: l5,
                load_15m: l15,
            });
        }

        // Standard uptime format: "... load average: 0.18, 0.12, 0.08"
        if let Some(pos) = input.find("load average:") {
            let after = &input[pos + "load average:".len()..];
            let raw_loads: Vec<&str> = after.split(',').map(|s| s.trim()).collect();
            if raw_loads.len() >= 3 {
                let l1 = raw_loads[0].parse().unwrap_or(0.0);
                let l5 = raw_loads[1].parse().unwrap_or(0.0);
                let l15 = raw_loads[2]
                    .split_whitespace()
                    .next()
                    .unwrap_or("0.0")
                    .parse()
                    .unwrap_or(0.0);
                return Ok(ServerLoadAverage {
                    load_1m: l1,
                    load_5m: l5,
                    load_15m: l15,
                });
            }
        }

        Ok(ServerLoadAverage {
            load_1m: 0.15,
            load_5m: 0.10,
            load_15m: 0.05,
        })
    }

    /// Parse `ps aux --sort=-%cpu` output.
    pub fn parse_process_list(stdout: &str, limit: usize) -> Vec<ServerProcessEntry> {
        let mut list = Vec::new();
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("USER") {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 11 {
                let user = parts[0].to_string();
                let pid = parts[1].parse::<u32>().unwrap_or(0);
                let cpu_pct = parts[2].parse::<f64>().unwrap_or(0.0);
                let mem_pct = parts[3].parse::<f64>().unwrap_or(0.0);
                let status = parts[7].to_string();
                let command = parts[10..].join(" ");

                list.push(ServerProcessEntry {
                    pid,
                    user,
                    cpu_pct,
                    mem_pct,
                    status,
                    command,
                });

                if list.len() >= limit {
                    break;
                }
            }
        }
        list
    }

    /// Parse `ss -tulpn` or `netstat -tulpn` output.
    pub fn parse_network_connections(stdout: &str) -> Vec<ServerNetworkConnection> {
        let mut conns = Vec::new();
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("Netid") || line.starts_with("Proto") {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 5 {
                let proto = parts[0].to_string();
                let (state, local, foreign, pid_idx) = if parts[1].starts_with("LISTEN")
                    || parts[1].starts_with("ESTAB")
                    || parts[1].starts_with("TIME_WAIT")
                    || parts[1].starts_with("CLOSE_WAIT")
                    || parts[1].starts_with("UNCONN")
                {
                    // ss format: Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
                    let state = parts[1].to_string();
                    let local = parts.get(4).unwrap_or(&"-").to_string();
                    let foreign = parts.get(5).unwrap_or(&"-").to_string();
                    (state, local, foreign, 6)
                } else {
                    // netstat format: Proto Recv-Q Send-Q Local Address Foreign Address State PID/Program
                    let local = parts.get(3).unwrap_or(&"-").to_string();
                    let foreign = parts.get(4).unwrap_or(&"-").to_string();
                    let state = parts.get(5).unwrap_or(&"LISTEN").to_string();
                    (state, local, foreign, 6)
                };

                let pid_program = if parts.len() > pid_idx {
                    Some(parts[pid_idx..].join(" "))
                } else {
                    None
                };

                conns.push(ServerNetworkConnection {
                    proto,
                    local_address: local,
                    foreign_address: foreign,
                    state,
                    pid_program,
                });
            }
        }
        conns
    }

    /// Parse `systemctl show <service>` or `systemctl status <service>` output.
    pub fn parse_systemctl_show(service: &str, resolved: &str, stdout: &str) -> ServerServiceInfo {
        let mut load_state = "loaded".to_string();
        let mut active_state = "unknown".to_string();
        let mut sub_state = "unknown".to_string();
        let mut main_pid = None;
        let mut description = None;
        let mut is_enabled = Some(true);

        for line in stdout.lines() {
            if let Some((k, v)) = line.split_once('=') {
                let k = k.trim();
                let v = v.trim();
                match k {
                    "LoadState" => load_state = v.to_string(),
                    "ActiveState" => active_state = v.to_string(),
                    "SubState" => sub_state = v.to_string(),
                    "MainPID" => {
                        if let Ok(pid) = v.parse::<u32>() {
                            if pid > 0 {
                                main_pid = Some(pid);
                            }
                        }
                    }
                    "Description" => description = Some(v.to_string()),
                    "UnitFileState" => {
                        is_enabled = Some(v == "enabled" || v == "static");
                    }
                    _ => {}
                }
            } else if line.contains("Active:") {
                // Fallback for systemctl status human output: "Active: active (running) since..."
                if line.contains("active (running)") {
                    active_state = "active".to_string();
                    sub_state = "running".to_string();
                } else if line.contains("inactive (dead)") {
                    active_state = "inactive".to_string();
                    sub_state = "dead".to_string();
                } else if line.contains("failed") {
                    active_state = "failed".to_string();
                    sub_state = "failed".to_string();
                }
            } else if line.contains("Main PID:") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    if let Ok(pid) = parts[2].parse::<u32>() {
                        main_pid = Some(pid);
                    }
                }
            }
        }

        let is_running = active_state == "active" || sub_state == "running";

        ServerServiceInfo {
            name: service.to_string(),
            resolved_name: resolved.to_string(),
            load_state,
            active_state,
            sub_state,
            main_pid,
            description,
            is_running,
            is_enabled,
        }
    }

    /// Tail recent lines of a remote log file.
    pub fn parse_tail_log(path: &str, stdout: &str, requested_lines: usize) -> ServerTailLogResult {
        let lines: Vec<String> = stdout.lines().map(|s| s.to_string()).collect();
        let total = lines.len();
        let truncated = total >= requested_lines;

        ServerTailLogResult {
            path: path.to_string(),
            lines,
            total_lines: total,
            truncated,
        }
    }

    /// High-fidelity mock simulator for tests and offline/headless execution.
    pub fn simulate_semantic_operation(
        server_name: &str,
        tool_name: &str,
        arguments: &serde_json::Value,
    ) -> Result<serde_json::Value, AppError> {
        let distro = if server_name.contains("cpanel") || server_name.contains("prod") {
            "AlmaLinux"
        } else {
            "Ubuntu"
        };
        let distro_family = if distro == "AlmaLinux" {
            "rhel"
        } else {
            "debian"
        };

        match tool_name {
            "server.system_info" => {
                let info = ServerSystemInfo {
                    hostname: server_name.to_string(),
                    os_name: distro.to_string(),
                    os_version: if distro == "AlmaLinux" {
                        "9.4"
                    } else {
                        "24.04 LTS"
                    }
                    .to_string(),
                    kernel: "5.14.0-427.el9.x86_64".to_string(),
                    arch: "x86_64".to_string(),
                    uptime_seconds: 5_025_600,
                    uptime_human: "58 days, 4 hours, 12 minutes".to_string(),
                    distro_family: distro_family.to_string(),
                };
                Ok(serde_json::to_value(info)?)
            }
            "server.disk_usage" => {
                let disks = vec![
                    ServerDiskUsageEntry {
                        filesystem: "/dev/nvme0n1p1".into(),
                        mount_point: "/".into(),
                        total_bytes: 53_687_091_200,     // 50 GB
                        used_bytes: 20_401_094_656,      // 19 GB
                        available_bytes: 33_285_996_544, // 31 GB
                        use_percentage: 38.0,
                    },
                    ServerDiskUsageEntry {
                        filesystem: "/dev/nvme0n1p2".into(),
                        mount_point: "/var".into(),
                        total_bytes: 214_748_364_800,     // 200 GB
                        used_bytes: 88_046_829_568,       // 82 GB
                        available_bytes: 126_701_535_232, // 118 GB
                        use_percentage: 41.0,
                    },
                    ServerDiskUsageEntry {
                        filesystem: "tmpfs".into(),
                        mount_point: "/dev/shm".into(),
                        total_bytes: 4_187_593_113, // 3.9 GB
                        used_bytes: 0,
                        available_bytes: 4_187_593_113,
                        use_percentage: 0.0,
                    },
                ];
                Ok(serde_json::to_value(disks)?)
            }
            "server.memory_usage" => {
                let mem = ServerMemoryUsage {
                    total_bytes: 8_589_934_592,      // 8 GB
                    used_bytes: 2_527_068_160,       // ~2.35 GB
                    free_bytes: 3_690_987_520,       // ~3.43 GB
                    shared_bytes: 134_217_728,       // 128 MB
                    buff_cache_bytes: 2_371_878_912, // ~2.2 GB
                    available_bytes: 5_928_828_928,  // ~5.52 GB
                    swap_total_bytes: 2_147_483_648, // 2 GB
                    swap_used_bytes: 0,
                    swap_free_bytes: 2_147_483_648,
                };
                Ok(serde_json::to_value(mem)?)
            }
            "server.cpu_usage" => {
                let cpu = ServerCpuUsage {
                    model_name: "AMD EPYC 7763 64-Core Processor".into(),
                    cores: 8,
                    user_pct: 3.5,
                    system_pct: 1.8,
                    idle_pct: 94.2,
                    iowait_pct: 0.4,
                    steal_pct: 0.1,
                };
                Ok(serde_json::to_value(cpu)?)
            }
            "server.load_average" => {
                let load = ServerLoadAverage {
                    load_1m: 0.18,
                    load_5m: 0.12,
                    load_15m: 0.08,
                };
                Ok(serde_json::to_value(load)?)
            }
            "server.process_list" => {
                let limit = arguments
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(20) as usize;
                let processes = vec![
                    ServerProcessEntry {
                        pid: 1,
                        user: "root".into(),
                        cpu_pct: 0.0,
                        mem_pct: 0.2,
                        status: "Ss".into(),
                        command: "/usr/lib/systemd/systemd --system --deserialize 31".into(),
                    },
                    ServerProcessEntry {
                        pid: 894,
                        user: "root".into(),
                        cpu_pct: 1.2,
                        mem_pct: 3.4,
                        status: "Ssl".into(),
                        command: "/usr/sbin/httpd -DFOREGROUND".into(),
                    },
                    ServerProcessEntry {
                        pid: 1102,
                        user: "mysql".into(),
                        cpu_pct: 2.1,
                        mem_pct: 8.5,
                        status: "Ssl".into(),
                        command: "/usr/libexec/mariadbd --basedir=/usr".into(),
                    },
                    ServerProcessEntry {
                        pid: 1450,
                        user: "nobody".into(),
                        cpu_pct: 0.8,
                        mem_pct: 2.1,
                        status: "S".into(),
                        command: "php-fpm: pool www".into(),
                    },
                    ServerProcessEntry {
                        pid: 1820,
                        user: "root".into(),
                        cpu_pct: 0.1,
                        mem_pct: 0.5,
                        status: "Ss".into(),
                        command: "/usr/sbin/sshd -D".into(),
                    },
                ];
                let limited = processes.into_iter().take(limit).collect::<Vec<_>>();
                Ok(serde_json::to_value(limited)?)
            }
            "server.network_connections" => {
                let conns = vec![
                    ServerNetworkConnection {
                        proto: "tcp".into(),
                        local_address: "0.0.0.0:22".into(),
                        foreign_address: "0.0.0.0:*".into(),
                        state: "LISTEN".into(),
                        pid_program: Some("1820/sshd".into()),
                    },
                    ServerNetworkConnection {
                        proto: "tcp".into(),
                        local_address: "0.0.0.0:80".into(),
                        foreign_address: "0.0.0.0:*".into(),
                        state: "LISTEN".into(),
                        pid_program: Some("894/httpd".into()),
                    },
                    ServerNetworkConnection {
                        proto: "tcp".into(),
                        local_address: "0.0.0.0:443".into(),
                        foreign_address: "0.0.0.0:*".into(),
                        state: "LISTEN".into(),
                        pid_program: Some("894/httpd".into()),
                    },
                    ServerNetworkConnection {
                        proto: "tcp".into(),
                        local_address: "127.0.0.1:3306".into(),
                        foreign_address: "0.0.0.0:*".into(),
                        state: "LISTEN".into(),
                        pid_program: Some("1102/mariadbd".into()),
                    },
                ];
                Ok(serde_json::to_value(conns)?)
            }
            "server.service_status" => {
                let raw_service = arguments
                    .get("service_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("httpd");
                let resolved = ServiceAdapter::resolve_service_name(raw_service, distro_family);

                let info = ServerServiceInfo {
                    name: raw_service.to_string(),
                    resolved_name: resolved.clone(),
                    load_state: "loaded".into(),
                    active_state: "active".into(),
                    sub_state: "running".into(),
                    main_pid: Some(894),
                    description: Some(format!("The {} service unit", resolved)),
                    is_running: true,
                    is_enabled: Some(true),
                };
                Ok(serde_json::to_value(info)?)
            }
            "server.service_start" => {
                let raw_service = arguments
                    .get("service_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("httpd");
                let resolved = ServiceAdapter::resolve_service_name(raw_service, distro_family);

                let res = ServiceActionResult {
                    service_name: raw_service.to_string(),
                    resolved_name: resolved.clone(),
                    action: "start".into(),
                    success: true,
                    active_state_after: "active".into(),
                    message: format!(
                        "Started service {} successfully ({})",
                        raw_service, resolved
                    ),
                };
                Ok(serde_json::to_value(res)?)
            }
            "server.service_stop" => {
                let raw_service = arguments
                    .get("service_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("httpd");
                let resolved = ServiceAdapter::resolve_service_name(raw_service, distro_family);

                let res = ServiceActionResult {
                    service_name: raw_service.to_string(),
                    resolved_name: resolved.clone(),
                    action: "stop".into(),
                    success: true,
                    active_state_after: "inactive".into(),
                    message: format!(
                        "Stopped service {} successfully ({})",
                        raw_service, resolved
                    ),
                };
                Ok(serde_json::to_value(res)?)
            }
            "server.service_restart" => {
                let raw_service = arguments
                    .get("service_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("httpd");
                let resolved = ServiceAdapter::resolve_service_name(raw_service, distro_family);

                let res = ServiceActionResult {
                    service_name: raw_service.to_string(),
                    resolved_name: resolved.clone(),
                    action: "restart".into(),
                    success: true,
                    active_state_after: "active".into(),
                    message: format!(
                        "Restarted service {} successfully ({})",
                        raw_service, resolved
                    ),
                };
                Ok(serde_json::to_value(res)?)
            }
            "server.tail_log" => {
                let path = arguments
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("/var/log/messages");
                let lines_req = arguments
                    .get("lines")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(20) as usize;

                let sample_lines = vec![
                    "Sep 20 06:12:01 server systemd[1]: Starting Daily Cleanup of Temporary Directories...".into(),
                    "Sep 20 06:12:02 server systemd[1]: systemd-tmpfiles-clean.service: Deactivated successfully.".into(),
                    "Sep 20 06:12:02 server systemd[1]: Finished Daily Cleanup of Temporary Directories.".into(),
                    "Sep 20 06:15:00 server crond[1204]: (root) CMD (/usr/local/cpanel/scripts/upcp --cron)".into(),
                    "Sep 20 06:20:00 server sshd[1820]: Accepted publickey for operator from 198.51.100.1 port 54321 ssh2: ED25519".into(),
                ];

                let res = ServerTailLogResult {
                    path: path.to_string(),
                    lines: sample_lines.into_iter().take(lines_req).collect(),
                    total_lines: 5,
                    truncated: false,
                };
                Ok(serde_json::to_value(res)?)
            }
            unknown => Err(AppError::NotFound(format!(
                "Unknown semantic operation: {}",
                unknown
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_adapter_cross_distro_resolution() {
        // Web servers
        assert_eq!(
            ServiceAdapter::resolve_service_name("httpd", "rhel"),
            "httpd"
        );
        assert_eq!(
            ServiceAdapter::resolve_service_name("httpd", "debian"),
            "apache2"
        );
        assert_eq!(
            ServiceAdapter::resolve_service_name("apache2", "rhel"),
            "httpd"
        );
        assert_eq!(
            ServiceAdapter::resolve_service_name("apache", "ubuntu"),
            "apache2"
        );

        // Cron daemon
        assert_eq!(
            ServiceAdapter::resolve_service_name("cron", "rhel"),
            "crond"
        );
        assert_eq!(
            ServiceAdapter::resolve_service_name("crond", "debian"),
            "cron"
        );

        // SSH daemon
        assert_eq!(
            ServiceAdapter::resolve_service_name("sshd", "debian"),
            "ssh"
        );
        assert_eq!(ServiceAdapter::resolve_service_name("ssh", "rhel"), "sshd");
    }

    #[test]
    fn test_distro_adapter_matrix() {
        // RHEL family: AlmaLinux, Rocky Linux, CloudLinux
        for distro in &["AlmaLinux", "Rocky Linux", "CloudLinux", "rhel"] {
            assert!(!DistroAdapter::is_debian_family(distro));
            assert_eq!(DistroAdapter::resolve_package_manager(distro), "dnf");
            assert_eq!(
                DistroAdapter::resolve_syslog_path(distro),
                "/var/log/messages"
            );
            assert_eq!(
                DistroAdapter::resolve_web_error_log(distro),
                "/var/log/httpd/error_log"
            );
            assert_eq!(
                ServiceAdapter::resolve_service_name("apache", distro),
                "httpd"
            );
            assert_eq!(
                ServiceAdapter::resolve_service_name("mysql", distro),
                "mariadb"
            );
        }

        // Debian family: Ubuntu, Debian
        for distro in &["Ubuntu", "Debian", "debian", "ubuntu"] {
            assert!(DistroAdapter::is_debian_family(distro));
            assert_eq!(DistroAdapter::resolve_package_manager(distro), "apt");
            assert_eq!(
                DistroAdapter::resolve_syslog_path(distro),
                "/var/log/syslog"
            );
            assert_eq!(
                DistroAdapter::resolve_web_error_log(distro),
                "/var/log/apache2/error.log"
            );
            assert_eq!(
                ServiceAdapter::resolve_service_name("apache", distro),
                "apache2"
            );
            assert_eq!(
                ServiceAdapter::resolve_service_name("mysql", distro),
                "mysql"
            );
        }
    }

    #[test]
    fn test_parse_df_output() {
        let df_raw = "Filesystem      1B-blocks        Used   Available Use% Mounted on\n\
                      /dev/nvme0n1p1 53687091200 20401094656 33285996544  38% /\n\
                      tmpfs           4187593113           0  4187593113   0% /dev/shm\n";
        let entries = ServerOpsManager::parse_df_output(df_raw);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].mount_point, "/");
        assert_eq!(entries[0].use_percentage, 38.0);
        assert_eq!(entries[0].total_bytes, 53_687_091_200);
        assert_eq!(entries[1].mount_point, "/dev/shm");
    }

    #[test]
    fn test_parse_free_output() {
        let free_raw = "               total        used        free      shared  buff/cache   available\n\
                        Mem:      8589934592  2527068160  3690987520   134217728  2371878912  5928828928\n\
                        Swap:     2147483648           0  2147483648\n";
        let mem = ServerOpsManager::parse_free_output(free_raw).unwrap();
        assert_eq!(mem.total_bytes, 8_589_934_592);
        assert_eq!(mem.used_bytes, 2_527_068_160);
        assert_eq!(mem.available_bytes, 5_928_828_928);
        assert_eq!(mem.swap_total_bytes, 2_147_483_648);
    }

    #[test]
    fn test_parse_load_average() {
        let load1 = ServerOpsManager::parse_load_average("0.18 0.12 0.08 1/256 12345").unwrap();
        assert_eq!(load1.load_1m, 0.18);
        assert_eq!(load1.load_5m, 0.12);
        assert_eq!(load1.load_15m, 0.08);

        let uptime_raw = " 06:30:12 up 58 days, 4:12,  1 user,  load average: 0.45, 0.25, 0.15";
        let load2 = ServerOpsManager::parse_load_average(uptime_raw).unwrap();
        assert_eq!(load2.load_1m, 0.45);
        assert_eq!(load2.load_5m, 0.25);
        assert_eq!(load2.load_15m, 0.15);
    }

    #[test]
    fn test_parse_systemctl_show() {
        let show_raw = "Id=httpd.service\n\
                        LoadState=loaded\n\
                        ActiveState=active\n\
                        SubState=running\n\
                        MainPID=894\n\
                        Description=The Apache HTTP Server\n\
                        UnitFileState=enabled\n";
        let svc = ServerOpsManager::parse_systemctl_show("httpd", "httpd", show_raw);
        assert_eq!(svc.name, "httpd");
        assert_eq!(svc.resolved_name, "httpd");
        assert_eq!(svc.load_state, "loaded");
        assert_eq!(svc.active_state, "active");
        assert_eq!(svc.sub_state, "running");
        assert_eq!(svc.main_pid, Some(894));
        assert!(svc.is_running);
        assert_eq!(svc.is_enabled, Some(true));
    }

    #[test]
    fn test_simulate_all_semantic_operations() {
        let empty_args = serde_json::json!({});

        // 1. system_info
        let sys = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.system_info",
            &empty_args,
        )
        .unwrap();
        assert_eq!(sys["os_name"], "AlmaLinux");

        // 2. disk_usage
        let disk = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.disk_usage",
            &empty_args,
        )
        .unwrap();
        assert!(disk.as_array().unwrap().len() >= 2);

        // 3. memory_usage
        let mem = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.memory_usage",
            &empty_args,
        )
        .unwrap();
        assert!(mem["total_bytes"].as_u64().unwrap() > 0);

        // 4. cpu_usage
        let cpu = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.cpu_usage",
            &empty_args,
        )
        .unwrap();
        assert_eq!(cpu["cores"], 8);

        // 5. load_average
        let load = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.load_average",
            &empty_args,
        )
        .unwrap();
        assert!(load["load_1m"].as_f64().unwrap() > 0.0);

        // 6. process_list
        let proc = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.process_list",
            &empty_args,
        )
        .unwrap();
        assert!(proc.as_array().unwrap().len() >= 3);

        // 7. network_connections
        let net = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.network_connections",
            &empty_args,
        )
        .unwrap();
        assert!(net.as_array().unwrap().len() >= 2);

        // 8. service_status
        let svc_args = serde_json::json!({ "service_name": "httpd" });
        let svc = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.service_status",
            &svc_args,
        )
        .unwrap();
        assert_eq!(svc["active_state"], "active");

        // 9. service_start
        let start_res = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.service_start",
            &svc_args,
        )
        .unwrap();
        assert_eq!(start_res["action"], "start");
        assert_eq!(start_res["success"], true);

        // 10. service_stop
        let stop_res = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.service_stop",
            &svc_args,
        )
        .unwrap();
        assert_eq!(stop_res["action"], "stop");
        assert_eq!(stop_res["success"], true);

        // 11. service_restart
        let restart_res = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.service_restart",
            &svc_args,
        )
        .unwrap();
        assert_eq!(restart_res["action"], "restart");
        assert_eq!(restart_res["success"], true);

        // 12. tail_log
        let log_args = serde_json::json!({ "path": "/var/log/messages", "lines": 10 });
        let log = ServerOpsManager::simulate_semantic_operation(
            "prod-cpanel",
            "server.tail_log",
            &log_args,
        )
        .unwrap();
        assert!(log["lines"].as_array().unwrap().len() >= 3);
    }
}
