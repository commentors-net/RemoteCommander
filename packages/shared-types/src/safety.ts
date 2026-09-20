/**
 * Production Safety Layer Types
 * Authoritative baseline defined in Master Specification §0.4, §0.5, §10, §12 (M9).
 */

export interface SafetyBackupRecord {
  id: string;
  server_id: string;
  file_path: string;
  backup_path: string;
  created_at: string;
  size_bytes: number;
  checksum_sha256: string;
  reason: string;
  created_by: string;
  restored: boolean;
  restored_at?: string | null | undefined;
}

export interface SafePatchRequest {
  server_id: string;
  file_path: string;
  patched_content: string;
  validation_command?: string | null | undefined;
  service_restart_command?: string | null | undefined;
  timeout_seconds?: number | null | undefined;
}

export interface SafePatchResult {
  success: boolean;
  backup_id: string;
  backup_path: string;
  patch_applied: boolean;
  validation_passed: boolean;
  service_restarted: boolean;
  rolled_back: boolean;
  message: string;
}

export interface FullAccessStatus {
  is_active: boolean;
  expires_at?: string | null | undefined;
  remaining_seconds?: number | null | undefined;
  mode: string;
}

export interface EnhancedApprovalInfo {
  authenticated_user?: string | null | undefined;
  target_resource?: string | null | undefined;
  likely_impact?: string | null | undefined;
  rollback_state?: string | null | undefined;
}
