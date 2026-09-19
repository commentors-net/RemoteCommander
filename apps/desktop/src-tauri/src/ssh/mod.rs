//! SSH Transport and Host Verification Subsystem
//! Authoritative baseline: Master Spec §0.3, §8 (M5), and ADR 0004.
//! Enforces Security Gate E: Mandatory host verification and fingerprint mismatch blocking.

pub mod fingerprint;
pub mod known_hosts;
pub mod ssh_config;
pub mod transport;

pub use fingerprint::{compute_sha256_fingerprint, parse_host_key_entry};
pub use known_hosts::{KnownHostEntry, KnownHostsManager};
pub use ssh_config::{
    default_ssh_config_path, load_user_ssh_config, parse_ssh_config, resolve_alias,
};
pub use transport::{MockSshTransport, SshTransport, SystemOpenSshTransport};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{HostKeyInfo, ServerRecord};
    use chrono::Utc;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_m5_acceptance_scenario_and_gate_e_verification() {
        // 1. Setup temporary known_hosts file
        let temp_file = NamedTempFile::new().unwrap();
        let known_hosts_path = temp_file.path().to_path_buf();
        let mut known_hosts = KnownHostsManager::new(known_hosts_path);

        // 2. Setup mock SSH transport
        let mock_transport = MockSshTransport::new();

        let target_server = ServerRecord {
            id: "srv-prod-01".into(),
            name: "production-cpanel-01".into(),
            hostname: "198.51.100.15".into(),
            port: 22,
            username: "root".into(),
            environment: "PRODUCTION".into(),
            auth_method: "SSH_KEY".into(),
            credential_ref: Some("vault:ssh:prod-cpanel-01".into()),
            ssh_key_path: Some("~/.ssh/id_ed25519".into()),
            ssh_config_alias: Some("prod-cpanel".into()),
            cpanel_enabled: true,
            whm_port: Some(2087),
            whm_token_ref: Some("vault:whm:prod-cpanel-01".into()),
            tags_json: "[\"production\",\"cpanel\"]".into(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };

        let initial_key = HostKeyInfo {
            key_type: "ssh-ed25519".into(),
            public_key_base64:
                "AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z3m".into(),
            fingerprint_sha256: compute_sha256_fingerprint(
                "AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z3m",
            )
            .unwrap(),
        };
        mock_transport.register_host_key("198.51.100.15", 22, initial_key.clone());

        // Step 1: First connection test (NewHost status)
        let res1 = mock_transport
            .test_connection(&target_server, &mut known_hosts, None)
            .await
            .expect("Connection test should run");

        assert!(res1.success);
        assert_eq!(res1.hostname, "198.51.100.15");
        assert_eq!(res1.username, "root");
        assert_eq!(res1.host_key_status, "NEW_HOST");
        assert!(res1.host_key.is_some());
        assert_eq!(
            res1.host_key.as_ref().unwrap().fingerprint_sha256,
            initial_key.fingerprint_sha256
        );

        // Step 2: Accept and store host key in known_hosts
        known_hosts
            .accept_and_save("198.51.100.15", 22, &initial_key)
            .expect("Should save host key");

        // Step 3: Second connection test (Trusted status)
        let res2 = mock_transport
            .test_connection(&target_server, &mut known_hosts, None)
            .await
            .expect("Connection test should run");

        assert!(res2.success);
        assert_eq!(res2.host_key_status, "TRUSTED");

        // Step 4: SECURITY GATE E TEST - Host key changes (MITM attack simulation)
        let rogue_mitm_key = HostKeyInfo {
            key_type: "ssh-ed25519".into(),
            public_key_base64:
                "AAAAC3NzaC1lZDI1NTE5AAAAIAttackerRogueKeyPayload1234567890ABCDEF1234".into(),
            fingerprint_sha256: compute_sha256_fingerprint(
                "AAAAC3NzaC1lZDI1NTE5AAAAIAttackerRogueKeyPayload1234567890ABCDEF1234",
            )
            .unwrap(),
        };
        mock_transport.register_host_key("198.51.100.15", 22, rogue_mitm_key.clone());

        let res3 = mock_transport
            .test_connection(&target_server, &mut known_hosts, None)
            .await
            .expect("Connection test should run");

        // Gate E Invariant: Connection MUST BE BLOCKED!
        assert!(!res3.success);
        assert_eq!(res3.host_key_status, "CHANGED_WARNING");
        assert_eq!(
            res3.previous_fingerprint.as_deref(),
            Some(initial_key.fingerprint_sha256.as_str())
        );
        assert_eq!(
            res3.new_fingerprint.as_deref(),
            Some(rogue_mitm_key.fingerprint_sha256.as_str())
        );
        assert!(res3.error_message.unwrap().contains("WARNING"));
    }
}
