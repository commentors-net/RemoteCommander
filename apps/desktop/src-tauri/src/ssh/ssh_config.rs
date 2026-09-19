//! OpenSSH ~/.ssh/config parser and alias resolution
//! Master Spec §0.3, §8 Compatibility Goals: ~/.ssh/config, ProxyJump, SSH agent.

use crate::models::DiscoveredSshHost;
use std::fs;
use std::path::{Path, PathBuf};

pub fn default_ssh_config_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    Path::new(&home).join(".ssh").join("config")
}

pub fn parse_ssh_config(content: &str) -> Vec<DiscoveredSshHost> {
    let mut hosts = Vec::new();
    let mut current_alias: Option<String> = None;
    let mut current_hostname: Option<String> = None;
    let mut current_port: u16 = 22;
    let mut current_user: Option<String> = None;
    let mut current_key: Option<String> = None;
    let mut current_jump: Option<String> = None;

    let flush_host = |hosts: &mut Vec<DiscoveredSshHost>,
                      alias: Option<String>,
                      hostname: Option<String>,
                      port: u16,
                      user: Option<String>,
                      key: Option<String>,
                      jump: Option<String>| {
        if let Some(a) = alias {
            // Ignore wildcard Host entries like "Host *"
            if !a.contains('*') && !a.contains('?') {
                hosts.push(DiscoveredSshHost {
                    alias: a.clone(),
                    hostname: hostname.unwrap_or(a),
                    port,
                    username: user,
                    identity_file: key,
                    proxy_jump: jump,
                });
            }
        }
    };

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Support both "Key Value" and "Key = Value"
        let parts: Vec<&str> = if let Some((k, v)) = line.split_once('=') {
            vec![k.trim(), v.trim()]
        } else {
            line.split_whitespace().collect()
        };

        if parts.len() < 2 {
            continue;
        }

        let key = parts[0].to_ascii_lowercase();
        let val = parts[1..].join(" ");

        if key == "host" {
            // Flush previous host block
            flush_host(
                &mut hosts,
                current_alias.take(),
                current_hostname.take(),
                current_port,
                current_user.take(),
                current_key.take(),
                current_jump.take(),
            );
            current_alias = Some(val);
            current_port = 22;
        } else if current_alias.is_some() {
            match key.as_str() {
                "hostname" => current_hostname = Some(val),
                "port" => {
                    if let Ok(p) = val.parse::<u16>() {
                        current_port = p;
                    }
                }
                "user" => current_user = Some(val),
                "identityfile" => current_key = Some(val),
                "proxyjump" => current_jump = Some(val),
                _ => {}
            }
        }
    }

    // Flush last host block
    flush_host(
        &mut hosts,
        current_alias,
        current_hostname,
        current_port,
        current_user,
        current_key,
        current_jump,
    );

    hosts
}

pub fn load_user_ssh_config() -> Vec<DiscoveredSshHost> {
    let path = default_ssh_config_path();
    if !path.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&path) {
        Ok(content) => parse_ssh_config(&content),
        Err(_) => Vec::new(),
    }
}

pub fn resolve_alias(alias: &str) -> Option<DiscoveredSshHost> {
    let hosts = load_user_ssh_config();
    hosts.into_iter().find(|h| h.alias == alias)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ssh_config() {
        let sample_config = r#"
# Global wildcard (should be skipped)
Host *
    ServerAliveInterval 60

Host prod-cpanel
    HostName 198.51.100.15
    User root
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host bastion
    HostName 192.168.1.1
    User admin

Host internal-app
    HostName 10.0.0.99
    User deploy
    ProxyJump bastion
"#;

        let hosts = parse_ssh_config(sample_config);
        assert_eq!(hosts.len(), 3);

        let prod = hosts.iter().find(|h| h.alias == "prod-cpanel").unwrap();
        assert_eq!(prod.hostname, "198.51.100.15");
        assert_eq!(prod.username, Some("root".into()));
        assert_eq!(prod.port, 2222);
        assert_eq!(prod.identity_file, Some("~/.ssh/id_ed25519".into()));

        let internal = hosts.iter().find(|h| h.alias == "internal-app").unwrap();
        assert_eq!(internal.proxy_jump, Some("bastion".into()));
    }
}
