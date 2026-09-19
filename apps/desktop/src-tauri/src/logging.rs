//! Structured Logging Layer with Secret Redaction
//! Authoritative baseline defined in Master Specification §4 and M1 tasks.

use tracing::subscriber::set_global_default;
use tracing_subscriber::{layer::SubscriberExt, EnvFilter, Registry};

pub fn init_logging() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("remote_commander_desktop=info,tauri=info"));

    let formatting_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_thread_ids(true);

    let subscriber = Registry::default().with(filter).with(formatting_layer);

    let _ = set_global_default(subscriber);
}

/// Redact known credential patterns from string content before logging
pub fn redact_sensitive_string(input: &str) -> String {
    let mut redacted = input.to_string();

    // Redact SSH private keys
    if redacted.contains("-----BEGIN") {
        return "[REDACTED_PRIVATE_KEY]".to_string();
    }

    // Redact OpenAI style keys
    if redacted.contains("sk-") {
        redacted = "[REDACTED_API_KEY]".to_string();
    }

    redacted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_redaction() {
        let sensitive = format!("{}_TEST_KEY_PAYLOAD", "-----BEGIN");
        let cleaned = redact_sensitive_string(&sensitive);
        assert_eq!(cleaned, "[REDACTED_PRIVATE_KEY]");

        let dummy_token = "sk-proj-abc123xyz789";
        let cleaned_key = redact_sensitive_string(dummy_token);
        assert_eq!(cleaned_key, "[REDACTED_API_KEY]");

        let normal = "Server status: OK";
        assert_eq!(redact_sensitive_string(normal), "Server status: OK");
    }
}
