//! Secure Secret Storage and OS Keyring Integration
//! Authoritative baseline defined in Master Specification §0.10, §0.13 Gate A, §5 (M2), and ADR 0003.

use crate::database::Database;
use crate::error::AppError;
use chrono::Utc;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub const SERVICE_NAME: &str = "com.remotecommander.desktop";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecretMetadata {
    pub key: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CredentialRefRecord {
    pub id: String, // e.g. "cred:ai_key:550e8400-e29b-41d4-a716-446655440000"
    pub secret_type: String,
    pub label: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

/// Abstract Secret Store interface
pub trait SecretStore: Send + Sync {
    fn put(&self, key: &str, secret: &str) -> Result<(), AppError>;
    fn get(&self, key: &str) -> Result<String, AppError>;
    fn delete(&self, key: &str) -> Result<(), AppError>;
    fn exists(&self, key: &str) -> Result<bool, AppError>;
    fn metadata(&self, key: &str) -> Result<Option<SecretMetadata>, AppError>;
}

/// OS Native Keyring Secret Store (Windows Credential Manager / Keychain / Secret Service)
pub struct OsKeyringStore {
    service: String,
}

impl OsKeyringStore {
    pub fn new() -> Self {
        Self {
            service: SERVICE_NAME.to_string(),
        }
    }
}

impl Default for OsKeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for OsKeyringStore {
    fn put(&self, key: &str, secret: &str) -> Result<(), AppError> {
        let entry = Entry::new(&self.service, key)
            .map_err(|e| AppError::Internal(format!("Failed to create keyring entry: {}", e)))?;
        entry
            .set_password(secret)
            .map_err(|e| AppError::Internal(format!("Failed to store secret in keyring: {}", e)))?;
        Ok(())
    }

    fn get(&self, key: &str) -> Result<String, AppError> {
        let entry = Entry::new(&self.service, key)
            .map_err(|e| AppError::Internal(format!("Failed to create keyring entry: {}", e)))?;
        entry.get_password().map_err(|e| match e {
            keyring::Error::NoEntry => AppError::NotFound(format!("Secret not found: {}", key)),
            other => AppError::Internal(format!("Keyring retrieval failed: {}", other)),
        })
    }

    fn delete(&self, key: &str) -> Result<(), AppError> {
        let entry = Entry::new(&self.service, key)
            .map_err(|e| AppError::Internal(format!("Failed to create keyring entry: {}", e)))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // Idempotent delete
            Err(other) => Err(AppError::Internal(format!(
                "Keyring delete failed: {}",
                other
            ))),
        }
    }

    fn exists(&self, key: &str) -> Result<bool, AppError> {
        match self.get(key) {
            Ok(_) => Ok(true),
            Err(AppError::NotFound(_)) => Ok(false),
            Err(e) => Err(e),
        }
    }

    fn metadata(&self, key: &str) -> Result<Option<SecretMetadata>, AppError> {
        let exists = self.exists(key)?;
        if exists {
            Ok(Some(SecretMetadata {
                key: key.to_string(),
                exists: true,
            }))
        } else {
            Ok(None)
        }
    }
}

/// In-Memory Secret Store for testing and environments without OS keyrings
#[derive(Default)]
pub struct InMemorySecretStore {
    secrets: Mutex<HashMap<String, String>>,
}

impl InMemorySecretStore {
    pub fn new() -> Self {
        Self {
            secrets: Mutex::new(HashMap::new()),
        }
    }
}

impl SecretStore for InMemorySecretStore {
    fn put(&self, key: &str, secret: &str) -> Result<(), AppError> {
        let mut map = self.secrets.lock().unwrap();
        map.insert(key.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, key: &str) -> Result<String, AppError> {
        let map = self.secrets.lock().unwrap();
        map.get(key)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Secret not found: {}", key)))
    }

    fn delete(&self, key: &str) -> Result<(), AppError> {
        let mut map = self.secrets.lock().unwrap();
        map.remove(key);
        Ok(())
    }

    fn exists(&self, key: &str) -> Result<bool, AppError> {
        let map = self.secrets.lock().unwrap();
        Ok(map.contains_key(key))
    }

    fn metadata(&self, key: &str) -> Result<Option<SecretMetadata>, AppError> {
        let map = self.secrets.lock().unwrap();
        if map.contains_key(key) {
            Ok(Some(SecretMetadata {
                key: key.to_string(),
                exists: true,
            }))
        } else {
            Ok(None)
        }
    }
}

/// High-level SecretService coordinating the Keyring Store and SQLite metadata
pub struct SecretService {
    store: Arc<dyn SecretStore>,
}

impl SecretService {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self { store }
    }

    pub fn with_os_keyring() -> Self {
        Self::new(Arc::new(OsKeyringStore::new()))
    }

    pub fn with_in_memory() -> Self {
        Self::new(Arc::new(InMemorySecretStore::new()))
    }

    /// Save a secret into the SecretStore and register opaque reference in SQLite
    pub fn save_secret(
        &self,
        db: &Database,
        secret_type: &str,
        label: &str,
        secret_value: &str,
    ) -> Result<CredentialRefRecord, AppError> {
        if secret_value.trim().is_empty() {
            return Err(AppError::Validation("Secret value cannot be empty".into()));
        }

        // Generate opaque credential reference
        let id = format!("cred:{}:{}", secret_type.to_lowercase(), Uuid::new_v4());
        let now = Utc::now().to_rfc3339();

        // 1. Store raw secret securely in SecretStore
        self.store.put(&id, secret_value)?;

        // 2. Store non-secret metadata in SQLite credentials_refs
        let record = CredentialRefRecord {
            id: id.clone(),
            secret_type: secret_type.to_string(),
            label: label.to_string(),
            created_at: now,
            last_used_at: None,
        };

        db.save_credential_ref(&record)?;
        Ok(record)
    }

    /// Retrieve secret into memory (used strictly by native Rust operations, NEVER sent to frontend)
    pub fn get_secret(&self, db: &Database, credential_ref: &str) -> Result<String, AppError> {
        let secret = self.store.get(credential_ref)?;
        let _ = db.update_credential_last_used(credential_ref);
        Ok(secret)
    }

    /// Delete secret from both Keyring and SQLite metadata
    pub fn delete_secret(&self, db: &Database, credential_ref: &str) -> Result<(), AppError> {
        self.store.delete(credential_ref)?;
        db.delete_credential_ref(credential_ref)?;
        Ok(())
    }

    /// List non-secret credential references from SQLite
    pub fn list_credentials(&self, db: &Database) -> Result<Vec<CredentialRefRecord>, AppError> {
        db.list_credential_refs()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_secret_store() {
        let store = InMemorySecretStore::new();
        let key = "cred:test:123";
        let secret = "super-secret-api-key-xyz";

        assert!(!store.exists(key).unwrap());
        store.put(key, secret).unwrap();
        assert!(store.exists(key).unwrap());

        let retrieved = store.get(key).unwrap();
        assert_eq!(retrieved, secret);

        let meta = store.metadata(key).unwrap();
        assert!(meta.is_some());
        assert!(meta.unwrap().exists);

        store.delete(key).unwrap();
        assert!(!store.exists(key).unwrap());
        assert!(matches!(store.get(key).unwrap_err(), AppError::NotFound(_)));
    }

    #[test]
    fn test_secret_service_and_zero_plaintext_sqlite() {
        let db = Database::in_memory().unwrap();
        let service = SecretService::with_in_memory();

        let dummy_payload = "test-token-payload-xyz-123456";
        let record = service
            .save_secret(&db, "AI_API_KEY", "Production OpenAI Key", dummy_payload)
            .expect("Should save secret");

        assert!(record.id.starts_with("cred:ai_api_key:"));
        assert_eq!(record.label, "Production OpenAI Key");

        // Verify secret retrieval into memory
        let retrieved = service.get_secret(&db, &record.id).unwrap();
        assert_eq!(retrieved, dummy_payload);

        // Verify SQLite table contains only metadata, ZERO plaintext secrets
        let refs = service.list_credentials(&db).unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].id, record.id);
        assert_eq!(refs[0].label, "Production OpenAI Key");

        // Delete
        service.delete_secret(&db, &record.id).unwrap();
        assert!(service.list_credentials(&db).unwrap().is_empty());
        assert!(service.get_secret(&db, &record.id).is_err());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_os_keyring_store_windows() {
        let store = OsKeyringStore::new();
        let key = "cred:ai_api_key:test-windows-credential";
        let secret = "sk-test-123456789";
        let put_res = store.put(key, secret);
        assert!(put_res.is_ok());
        let get_res = store.get(key);
        assert_eq!(get_res.unwrap(), secret);
        let _ = store.delete(key);
    }
}
