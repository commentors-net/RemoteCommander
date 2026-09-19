import { RiskLevel } from './risk.js';

/**
 * Audit records and events.
 * Authoritative baseline defined in Master Specification §20, §21, and Gate C.
 */
export type ToolExecutionStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ToolCallRecord {
  id: string; // Unique call ID (UUID)
  conversationId?: string;
  serverId?: string;
  toolName: string;
  argumentsJson: string;
  riskLevel: RiskLevel;
  status: ToolExecutionStatus;
  requestedAt: string; // ISO 8601
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  durationMs?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string; // ISO 8601
  eventType:
    'TOOL_INVOKED' | 'TOOL_APPROVED' | 'TOOL_REJECTED' | 'TOOL_COMPLETED' | 'SECURITY_VIOLATION';
  serverId?: string | undefined;
  toolName?: string | undefined;
  detailsJson: string;
}
