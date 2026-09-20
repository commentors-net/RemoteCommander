/**
 * Beta Hardening, Database Maintenance, and Distro Compatibility Models
 * Authoritative baseline defined in Master Specification §20 (Milestone M17), §26, and §27.
 */

export interface DatabaseIntegrityResult {
  ok: boolean;
  integrity_check: string;
  foreign_key_check: string[];
  schema_version: number;
  total_servers: number;
  total_audit_events: number;
  total_tool_calls: number;
  total_known_hosts: number;
  checked_at: string;
}

export interface DatabaseVacuumResult {
  success: boolean;
  message: string;
  vacuumed_at: string;
}

export type SupportedDistroFamily =
  'rhel' | 'debian' | 'ubuntu' | 'almalinux' | 'rocky' | 'cloudlinux';

export interface DistroCompatibilityMapping {
  distro: string;
  distroFamily: string;
  packageManager: string;
  syslogPath: string;
  webServerService: string;
  databaseService: string;
}

export interface ProviderFallbackEvent {
  fromProvider: string;
  toProvider: string;
  reason: string;
  iteration: number;
  timestamp: string;
}
