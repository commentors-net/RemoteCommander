/**
 * Private Alpha & System Readiness Models
 * Authoritative baseline defined in Master Specification §19 (Milestone M16), §51, §102, and §26.
 */

export type AlphaReadinessStatus = 'READY_FOR_ALPHA' | 'DEGRADED' | 'NOT_READY';

export interface AlphaCheckItem {
  gate: string;
  title: string;
  description: string;
  passed: boolean;
  details?: string | undefined;
}

export interface AlphaReadinessReport {
  status: AlphaReadinessStatus;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  timestamp: string;
  checks: AlphaCheckItem[];
}

export type AuditExportFormat = 'json' | 'csv';

export interface AuditExportFilter {
  serverId?: string | undefined;
  eventType?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
}
