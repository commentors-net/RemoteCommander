/**
 * WHM/cPanel Domain Types & Interfaces
 * Authoritative baseline defined in Master Specification §14 and Milestone M11.
 */

export interface CpanelServerInfo {
  hostname: string;
  version: string;
  build: string;
  license_status: string;
  operating_system: string;
  cpanel_release_tier: string;
  active_services_count: number;
}

export interface CpanelAccount {
  user: string;
  domain: string;
  email: string;
  plan: string;
  disk_used: string;
  disk_limit: string;
  disk_used_bytes: number;
  disk_limit_bytes: number;
  suspended: boolean;
  suspend_reason?: string | undefined;
  owner: string;
  start_date: string;
}

export interface CpanelAccountDetail {
  user: string;
  domain: string;
  email: string;
  plan: string;
  ip: string;
  disk_used: string;
  disk_limit: string;
  disk_used_bytes: number;
  disk_limit_bytes: number;
  bandwidth_used_bytes: number;
  bandwidth_limit_bytes: number;
  suspended: boolean;
  suspend_reason?: string | undefined;
  suspend_time?: string | undefined;
  owner: string;
  backup_enabled: boolean;
  php_version?: string | undefined;
  theme: string;
  max_ftp: string;
  max_sql: string;
  max_pop: string;
}

export type CpanelDomainType = 'main' | 'subdomain' | 'addon' | 'parked';

export interface CpanelDomainEntry {
  domain: string;
  user: string;
  domain_type: CpanelDomainType;
  document_root: string;
  ssl_status: string;
  php_version?: string | undefined;
}

export interface CpanelServiceStatus {
  service_name: string;
  monitored: boolean;
  running: boolean;
  installed: boolean;
  version?: string | undefined;
}

export interface CpanelServiceRestartResult {
  service_name: string;
  success: boolean;
  output: string;
  restarted_at: string;
}

export interface CpanelSslStatus {
  domain: string;
  user: string;
  has_ssl: boolean;
  issuer?: string | undefined;
  expires_at?: string | undefined;
  days_until_expiration?: number | undefined;
  is_valid: boolean;
  is_self_signed: boolean;
}

export interface CpanelBackupStatus {
  backup_enabled: boolean;
  backup_type: string;
  retention_daily: number;
  retention_weekly: number;
  retention_monthly: number;
  destination_type: string;
  last_run_time?: string | undefined;
  last_run_status?: string | undefined;
}

export interface CpanelDiskUsageBreakdown {
  user: string;
  domain: string;
  home_directory_bytes: number;
  mail_bytes: number;
  mysql_bytes: number;
  public_html_bytes: number;
  total_used_bytes: number;
  quota_bytes: number;
}

export interface CpanelPhpVersionInfo {
  system_default: string;
  installed_versions: string[];
  handlers: Record<string, string>;
}

export interface CpanelAccountSuspensionResult {
  user: string;
  action: 'suspend' | 'unsuspend';
  success: boolean;
  reason?: string | undefined;
  message: string;
  timestamp: string;
}
