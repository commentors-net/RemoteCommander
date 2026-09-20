//! Structured Logging Layer with Comprehensive Secret Redaction
//! Authoritative baseline defined in Master Specification §4, §17 (M14), §26 Gate A, and §27.

use regex::Regex;
use std::sync::LazyLock;
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

static PRIVATE_KEY_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"-----BEGIN (?:[A-Z0-9 ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+)?PRIVATE KEY-----")
        .expect("Valid regex")
});

static AUTH_HEADER_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic|token)\s+[a-z0-9\-._~+/]+=*")
        .expect("Valid regex")
});

static API_KEY_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(?:sk-ant-[-a-zA-Z0-9_]{16,}|sk-(?:proj-)?[-a-zA-Z0-9_]{20,}|AIzaSy[A-Za-z0-9_-]{33}|AKIA[0-9A-Z]{16})\b")
        .expect("Valid regex")
});

static PASSWORD_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)(password|passwd|pwd|db_pass|db_password)\s*([:=])\s*(?:'[^'\r\n]*'|"[^"\r\n]*"|[^\s"',;&|]{3,})"#)
        .expect("Valid regex")
});

static TOKEN_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)(whm_token|access_token|refresh_token)\s*([:=])\s*(?:'[^'\r\n]*'|"[^"\r\n]*"|[a-zA-Z0-9_-]{16,})"#)
        .expect("Valid regex")
});

static COOKIE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:cookie|set-cookie)\s*:\s*([^;\r\n]+)").expect("Valid regex")
});

/// Redact known credential patterns from string content before logging or storage
pub fn redact_sensitive_string(input: &str) -> String {
    let mut text = input.to_string();

    // 1. Private keys
    if text.contains("-----BEGIN") {
        text = PRIVATE_KEY_REGEX
            .replace_all(&text, "[REDACTED_PRIVATE_KEY]")
            .to_string();
        if text.contains("-----BEGIN") {
            // Fallback if boundary wasn't closed
            return "[REDACTED_PRIVATE_KEY]".to_string();
        }
    }

    // 2. Authorization headers
    text = AUTH_HEADER_REGEX
        .replace_all(&text, "Authorization: [REDACTED_AUTH_TOKEN]")
        .to_string();

    // 3. API keys
    text = API_KEY_REGEX
        .replace_all(&text, "[REDACTED_API_KEY]")
        .to_string();

    // 4. Passwords
    text = PASSWORD_REGEX
        .replace_all(&text, "$1$2 [REDACTED_PASSWORD]")
        .to_string();

    // 5. Tokens
    text = TOKEN_REGEX
        .replace_all(&text, "$1$2 [REDACTED_TOKEN]")
        .to_string();

    // 6. Cookies
    text = COOKIE_REGEX
        .replace_all(&text, "Cookie: [REDACTED_COOKIE]")
        .to_string();

    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_redaction() {
        let sensitive = format!("{}_TEST_KEY_PAYLOAD", "-----BEGIN");
        let cleaned = redact_sensitive_string(&sensitive);
        assert_eq!(cleaned, "[REDACTED_PRIVATE_KEY]");

        let dummy_token = "sk-proj-abc123xyz7890123456789";
        let cleaned_key = redact_sensitive_string(dummy_token);
        assert_eq!(cleaned_key, "[REDACTED_API_KEY]");

        let anthropic_key = format!("{}{}", "sk-ant-", "api03-sample1234567890");
        let cleaned_ant = redact_sensitive_string(&anthropic_key);
        assert_eq!(cleaned_ant, "[REDACTED_API_KEY]");

        let auth_hdr = "Authorization: Bearer secret-bearer-token-12345==";
        let cleaned_auth = redact_sensitive_string(auth_hdr);
        assert_eq!(cleaned_auth, "Authorization: [REDACTED_AUTH_TOKEN]");

        let pwd_str = format!("db_{} = 'mySuperSecretPassword123'", "password");
        let cleaned_pwd = redact_sensitive_string(&pwd_str);
        assert!(cleaned_pwd.contains("[REDACTED_PASSWORD]"));

        let token_str = format!("{}: 'whmSecretToken1234567890'", "whm_token");
        let cleaned_token = redact_sensitive_string(&token_str);
        assert!(cleaned_token.contains("[REDACTED_TOKEN]"));

        let cookie_str = "Set-Cookie: session=secretSessionId12345; Path=/";
        let cleaned_cookie = redact_sensitive_string(cookie_str);
        assert!(cleaned_cookie.contains("[REDACTED_COOKIE]"));

        let normal = "Server status: OK";
        assert_eq!(redact_sensitive_string(normal), "Server status: OK");
    }
}
