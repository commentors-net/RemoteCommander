-- Migration 002: SSH Transport and Known Hosts Tracking (Milestone M5)
-- Enforces Security Gate E: Host verification mandatory by default.

-- Add ssh_config_alias to servers
ALTER TABLE servers ADD COLUMN ssh_config_alias TEXT;

-- Known hosts tracking table
CREATE TABLE IF NOT EXISTS known_hosts_cache (
    id TEXT PRIMARY KEY NOT NULL,
    hostname TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    key_type TEXT NOT NULL,
    public_key_base64 TEXT NOT NULL,
    fingerprint_sha256 TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_verified_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('TRUSTED', 'REVOKED', 'CHANGED_WARNING')),
    UNIQUE(hostname, port, key_type)
);

CREATE INDEX IF NOT EXISTS idx_known_hosts_lookup ON known_hosts_cache(hostname, port);
