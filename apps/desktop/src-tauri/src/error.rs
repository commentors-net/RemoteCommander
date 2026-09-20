//! Structured Application Error Model
//! Authoritative baseline defined in Master Specification §4 and M1 tasks.

use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Migration error: {0}")]
    Migration(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Security violation: {0}")]
    SecurityViolation(String),

    #[error("I/O error: {0}")]
    Io(String),

    #[error("Execution error: {0}")]
    ExecutionFailed(String),

    #[error("Invalid tool input: {0}")]
    InvalidToolInput(String),

    #[error("Server not found: {0}")]
    ServerNotFound(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Database(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

// Serialize as string for Tauri IPC command bridge
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
