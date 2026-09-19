//! OpenSSH known_hosts reader, verifier, and manager
//! Enforces Security Gate E: Never silently disable host-key verification.

use crate::error::AppError;
use crate::models::{HostKeyInfo, HostKeyStatus};
use crate::ssh::fingerprint::parse_host_key_entry;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct KnownHostEntry {
    pub hostname: String,
    pub port: u16,
    pub host_key: HostKeyInfo,
}

pub struct KnownHostsManager {
    path: PathBuf,
    entries: HashMap<(String, u16), Vec<HostKeyInfo>>,
}

impl KnownHostsManager {
    pub fn new(path: PathBuf) -> Self {
        let mut mgr = Self {
            path,
            entries: HashMap::new(),
        };
        let _ = mgr.reload();
        mgr
    }

    pub fn default_path() -> PathBuf {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".into());
        Path::new(&home).join(".ssh").join("known_hosts")
    }

    pub fn from_default_path() -> Self {
        Self::new(Self::default_path())
    }

    pub fn reload(&mut self) -> Result<(), AppError> {
        self.entries.clear();
        if !self.path.exists() {
            return Ok(());
        }

        let content = fs::read_to_string(&self.path)?;
        for line in content.lines() {
            if let Some((host, port, info)) = parse_host_key_entry(line) {
                self.entries.entry((host, port)).or_default().push(info);
            }
        }
        Ok(())
    }

    /// Verifies offered host key against known_hosts.
    /// Security Gate E:
    /// - If matching key found -> Trusted
    /// - If no entry for host -> NewHost (requires user confirmation)
    /// - If entry exists for host with DIFFERENT key -> ChangedWarning (CRITICAL BLOCK!)
    pub fn verify_host_key(
        &self,
        hostname: &str,
        port: u16,
        offered: &HostKeyInfo,
    ) -> HostKeyStatus {
        if let Some(existing_keys) = self.entries.get(&(hostname.to_string(), port)) {
            // Check if any key for this host matches the offered key type and fingerprint
            for key in existing_keys {
                if key.key_type == offered.key_type {
                    if key.fingerprint_sha256 == offered.fingerprint_sha256 {
                        return HostKeyStatus::Trusted;
                    } else {
                        // KEY CHANGED for the same key type! Security Gate E violation!
                        return HostKeyStatus::ChangedWarning {
                            previous_fingerprint: key.fingerprint_sha256.clone(),
                            new_fingerprint: offered.fingerprint_sha256.clone(),
                            new_key_type: offered.key_type.clone(),
                        };
                    }
                }
            }

            // Host exists with other key types; if any differs, return ChangedWarning or NewHost
            if let Some(first) = existing_keys.first() {
                if first.fingerprint_sha256 != offered.fingerprint_sha256 {
                    return HostKeyStatus::ChangedWarning {
                        previous_fingerprint: first.fingerprint_sha256.clone(),
                        new_fingerprint: offered.fingerprint_sha256.clone(),
                        new_key_type: offered.key_type.clone(),
                    };
                }
            }
        }

        HostKeyStatus::NewHost {
            host_key: offered.clone(),
        }
    }

    /// Appends a trusted host key to known_hosts file
    pub fn accept_and_save(
        &mut self,
        hostname: &str,
        port: u16,
        host_key: &HostKeyInfo,
    ) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let line = if port == 22 {
            format!(
                "{} {} {}\n",
                hostname, host_key.key_type, host_key.public_key_base64
            )
        } else {
            format!(
                "[{}]:{} {} {}\n",
                hostname, port, host_key.key_type, host_key.public_key_base64
            )
        };

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(line.as_bytes())?;

        self.entries
            .entry((hostname.to_string(), port))
            .or_default()
            .push(host_key.clone());

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::fingerprint::compute_sha256_fingerprint;
    use tempfile::NamedTempFile;

    #[test]
    fn test_known_hosts_verification_flow() {
        let temp = NamedTempFile::new().unwrap();
        let path = temp.path().to_path_buf();

        let mut mgr = KnownHostsManager::new(path);

        let test_key_1 = HostKeyInfo {
            key_type: "ssh-ed25519".into(),
            public_key_base64:
                "AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z3m".into(),
            fingerprint_sha256: compute_sha256_fingerprint(
                "AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z3m",
            )
            .unwrap(),
        };

        // 1. Initial check: should be NewHost
        let status = mgr.verify_host_key("10.0.0.1", 22, &test_key_1);
        assert!(matches!(status, HostKeyStatus::NewHost { .. }));

        // 2. Accept and save key
        mgr.accept_and_save("10.0.0.1", 22, &test_key_1).unwrap();

        // 3. Check again: should be Trusted
        let status = mgr.verify_host_key("10.0.0.1", 22, &test_key_1);
        assert!(matches!(status, HostKeyStatus::Trusted));

        // 4. Check with altered key (Security Gate E scenario): MUST return ChangedWarning!
        let altered_key = HostKeyInfo {
            key_type: "ssh-ed25519".into(),
            public_key_base64:
                "AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z99".into(),
            fingerprint_sha256: compute_sha256_fingerprint(
                "AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z99",
            )
            .unwrap(),
        };

        let status = mgr.verify_host_key("10.0.0.1", 22, &altered_key);
        match status {
            HostKeyStatus::ChangedWarning {
                previous_fingerprint,
                new_fingerprint,
                ..
            } => {
                assert_eq!(previous_fingerprint, test_key_1.fingerprint_sha256);
                assert_eq!(new_fingerprint, altered_key.fingerprint_sha256);
            }
            _ => panic!("Expected ChangedWarning on host key mismatch!"),
        }
    }
}
