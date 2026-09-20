import { ServerEnvironment } from './server.js';
import { RiskLevel } from './risk.js';

/**
 * Multi-Server Target Grouping and Scoping Selector.
 * Defined in Master Specification §15 and Appendix A (Milestone M12).
 */
export type ServerTargetSelector =
  | { type: 'all' }
  | { type: 'environment'; environment: ServerEnvironment }
  | { type: 'tag'; tag: string }
  | { type: 'tags'; tags: string[]; matchMode?: 'all' | 'any' | undefined }
  | { type: 'server_ids'; serverIds: string[] };

/**
 * Multi-server bounded execution request payload.
 */
export interface MultiServerExecutionRequest {
  batchId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  selector: ServerTargetSelector;
  concurrencyLimit?: number | undefined; // Bounded: 1 to 20, defaults to 5
  timeoutSeconds?: number | undefined; // Per-server timeout, defaults to 30
  dryRun?: boolean | undefined;
}

/**
 * Result of execution on a single target server node.
 * Bounded with failure isolation.
 */
export interface NodeExecutionResult {
  serverId: string;
  serverName: string;
  hostname: string;
  environment: ServerEnvironment;
  success: boolean;
  durationMs: number;
  error?: string | undefined;
  data?: unknown | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
}

/**
 * Aggregated multi-server batch execution response.
 */
export interface MultiServerAggregateResult {
  batchId: string;
  toolName: string;
  selector: ServerTargetSelector;
  totalNodes: number;
  succeededNodes: number;
  failedNodes: number;
  nodes: NodeExecutionResult[];
  startedAt: string; // ISO 8601
  completedAt: string; // ISO 8601
  summaryMatrix?: Record<string, unknown> | undefined;
}

/**
 * Supported diagnostic types for parallel matrix queries.
 */
export type DiagnosticType =
  'system_info' | 'disk_usage' | 'memory_usage' | 'cpu_usage' | 'service_status';

/**
 * Request payload for a parallel diagnostic matrix evaluation.
 */
export interface MultiServerDiagnosticsMatrixRequest {
  batchId?: string | undefined;
  selector: ServerTargetSelector;
  diagnosticType: DiagnosticType;
  serviceName?: string | undefined;
  concurrencyLimit?: number | undefined;
  timeoutSeconds?: number | undefined;
}

/**
 * Normalized comparison row for the diagnostics matrix view.
 */
export interface DiagnosticsMatrixRow {
  serverId: string;
  serverName: string;
  hostname: string;
  environment: ServerEnvironment;
  success: boolean;
  error?: string | undefined;
  durationMs: number;
  osName?: string | undefined;
  distroFamily?: string | undefined;
  uptimeHuman?: string | undefined;
  cpuCores?: number | undefined;
  cpuUsagePct?: number | undefined;
  memoryUsagePct?: number | undefined;
  memoryUsedHuman?: string | undefined;
  memoryTotalHuman?: string | undefined;
  primaryDiskUsagePct?: number | undefined;
  primaryDiskUsedHuman?: string | undefined;
  primaryDiskTotalHuman?: string | undefined;
  serviceName?: string | undefined;
  serviceActive?: boolean | undefined;
  serviceStatusText?: string | undefined;
  rawOutput?: unknown | undefined;
}

/**
 * Aggregated diagnostics matrix result.
 */
export interface MultiServerDiagnosticsMatrixResult {
  batchId: string;
  diagnosticType: DiagnosticType;
  timestamp: string;
  totalNodes: number;
  succeededNodes: number;
  failedNodes: number;
  rows: DiagnosticsMatrixRow[];
}

/**
 * Multi-server security and policy evaluation record.
 * Ensures production risk inheritance (Gate A/Gate C).
 */
export interface BatchPolicyEvaluation {
  batchId: string;
  hasProductionServer: boolean;
  effectiveRiskLevel: RiskLevel;
  requiresConfirmation: boolean;
  confirmationCode?: string | undefined; // e.g. "CONFIRM BATCH"
  targetCount: number;
  targetServerIds: string[];
}
