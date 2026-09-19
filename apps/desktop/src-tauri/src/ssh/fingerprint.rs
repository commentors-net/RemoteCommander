//! SSH Host Key Fingerprinting and Parsing
//! Enforces Security Gate E: Authoritative host key verification (Master Spec §0.3, §8, §26).

use crate::error::AppError;
use crate::models::HostKeyInfo;
use base64::prelude::*;
use sha2::{Digest, Sha256};

/// Computes the standard OpenSSH SHA256 fingerprint from a base64-encoded public key.
/// Standard OpenSSH format: "SHA256:<base64-without-padding>"
pub fn compute_sha256_fingerprint(public_key_base64: &str) -> Result<String, AppError> {
    let clean_key = public_key_base64.trim();
    let key_bytes = BASE64_STANDARD
        .decode(clean_key)
        .map_err(|e| AppError::InvalidToolInput(format!("Invalid base64 in public key: {}", e)))?;

    let mut hasher = Sha256::new();
    hasher.update(&key_bytes);
    let hash = hasher.finalize();

    let b64_hash = BASE64_STANDARD_NO_PAD.encode(hash);
    Ok(format!("SHA256:{}", b64_hash))
}

/// Parses a line from ssh-keyscan or known_hosts format:
/// Format: `[hostname]:port key_type base64key` OR `hostname key_type base64key`
pub fn parse_host_key_entry(line: &str) -> Option<(String, u16, HostKeyInfo)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }

    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }

    let host_part = parts[0];
    let key_type = parts[1].to_string();
    let key_b64 = parts[2].to_string();

    let (hostname, port) = if host_part.starts_with('[') {
        // Format: [hostname]:port
        let mut split = host_part.trim_start_matches('[').split("]:");
        let host = split.next().unwrap_or("").to_string();
        let port_num = split
            .next()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(22);
        (host, port_num)
    } else {
        (host_part.to_string(), 22)
    };

    let fingerprint = compute_sha256_fingerprint(&key_b64).ok()?;

    Some((
        hostname,
        port,
        HostKeyInfo {
            key_type,
            public_key_base64: key_b64,
            fingerprint_sha256: fingerprint,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_sha256_fingerprint() {
        // Standard Ed25519 sample public key
        let b64_key = "AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z3m";
        let fp = compute_sha256_fingerprint(b64_key).expect("Should compute fingerprint");
        assert!(fp.starts_with("SHA256:"));
        assert_eq!(fp.len(), 50); // "SHA256:" (7 chars) + 43 base64 chars for 32 bytes unpadded
    }

    #[test]
    fn test_parse_host_key_entry() {
        let entry = "[192.168.1.50]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z3m";
        let parsed = parse_host_key_entry(entry);
        assert!(parsed.is_some());
        let (host, port, info) = parsed.unwrap();
        assert_eq!(host, "192.168.1.50");
        assert_eq!(port, 2222);
        assert_eq!(info.key_type, "ssh-ed25519");
        assert!(info.fingerprint_sha256.starts_with("SHA256:"));
    }
}
