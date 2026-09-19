-- Migration 001: Initial Schema
-- Enforces SQLite Local Storage invariants (ADR 0002, Master Spec §21)
-- Plaintext secrets are strictly prohibited from all tables.

PRAGMA foreign_keys = ON;

-- Application Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Target Server Inventory
CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('DEVELOPMENT', 'STAGING', 'PRODUCTION')),
    auth_method TEXT NOT NULL CHECK (auth_method IN ('SSH_KEY', 'SSH_AGENT', 'PASSWORD')),
    credential_ref TEXT, -- Opaque ID in OS keyring (NEVER plaintext)
    ssh_key_path TEXT,
    cpanel_enabled INTEGER NOT NULL DEFAULT 0,
    whm_port INTEGER DEFAULT 2087,
    whm_token_ref TEXT, -- Opaque ID in OS keyring (NEVER plaintext)
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Credential Metadata References (Metadata only, NO SECRETS)
CREATE TABLE IF NOT EXISTS credentials_refs (
    id TEXT PRIMARY KEY NOT NULL,
    secret_type TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    tool_calls_json TEXT,
    tool_call_id TEXT,
    created_at TEXT NOT NULL
);

-- Tool Calls
CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
    tool_name TEXT NOT NULL,
    arguments_json TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('READ_ONLY', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    requested_at TEXT NOT NULL,
    approved_at TEXT,
    approved_by TEXT,
    started_at TEXT,
    completed_at TEXT,
    exit_code INTEGER,
    duration_ms INTEGER,
    stdout_summary TEXT,
    stderr_summary TEXT
);

-- Approvals History
CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY NOT NULL,
    tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
    mode TEXT NOT NULL CHECK (mode IN ('APPROVAL_REQUIRED', 'SAFE_AUTOMATION', 'FULL_ACCESS')),
    typed_acknowledgement TEXT,
    timestamp TEXT NOT NULL
);

-- Immutable Audit Events
CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    server_id TEXT,
    tool_name TEXT,
    details_json TEXT NOT NULL
);

-- Schema Migration Tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_servers_env ON servers(environment);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_conv ON tool_calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_server ON tool_calls(server_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events(timestamp);
