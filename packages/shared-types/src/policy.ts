import { RiskLevel } from './risk.js';
import { ServerEnvironment } from './server.js';

/**
 * User permission modes.
 * Authoritative baseline defined in Master Specification §10.
 */
export type PermissionMode = 'APPROVAL_REQUIRED' | 'SAFE_AUTOMATION' | 'FULL_ACCESS';

export interface PolicyEvaluationRequest {
  toolName: string;
  targetServerId?: string;
  targetEnvironment?: ServerEnvironment;
  riskLevel: RiskLevel;
  mode: PermissionMode;
  isDestructiveHeuristicFlagged: boolean;
}

export type PolicyDecisionType =
  'ALLOW' | 'REQUIRE_APPROVAL' | 'REQUIRE_TYPED_CONFIRMATION' | 'DENY';

export interface PolicyDecision {
  decision: PolicyDecisionType;
  reason: string;
  riskLevel: RiskLevel;
  requiresTypedConfirmation: boolean;
  typedConfirmationPrompt?: string;
}

/**
 * Pure policy evaluation logic.
 */
export function evaluatePolicy(request: PolicyEvaluationRequest): PolicyDecision {
  const { riskLevel, mode, targetEnvironment, isDestructiveHeuristicFlagged } = request;

  // Critical operations always require typed confirmation
  if (riskLevel === 'CRITICAL' || isDestructiveHeuristicFlagged) {
    return {
      decision: 'REQUIRE_TYPED_CONFIRMATION',
      reason: 'Critical or destructive action requires explicit typed acknowledgement.',
      riskLevel: 'CRITICAL',
      requiresTypedConfirmation: true,
      typedConfirmationPrompt: 'Type the target server or action to confirm execution.',
    };
  }

  // Full access mode allows LOW and MEDIUM, but prompts for HIGH
  if (mode === 'FULL_ACCESS') {
    if (riskLevel === 'HIGH') {
      return {
        decision: 'REQUIRE_APPROVAL',
        reason: 'High risk actions require approval even in Full Access mode.',
        riskLevel,
        requiresTypedConfirmation: false,
      };
    }
    return {
      decision: 'ALLOW',
      reason: 'Allowed by Full Access mode.',
      riskLevel,
      requiresTypedConfirmation: false,
    };
  }

  // Safe Automation allows READ_ONLY and LOW (on non-production), requires approval otherwise
  if (mode === 'SAFE_AUTOMATION') {
    if (riskLevel === 'READ_ONLY') {
      return {
        decision: 'ALLOW',
        reason: 'Read-only operations run automatically in Safe Automation mode.',
        riskLevel,
        requiresTypedConfirmation: false,
      };
    }
    if (riskLevel === 'LOW' && targetEnvironment !== 'PRODUCTION') {
      return {
        decision: 'ALLOW',
        reason:
          'Low-risk actions run automatically on non-production targets in Safe Automation mode.',
        riskLevel,
        requiresTypedConfirmation: false,
      };
    }
    return {
      decision: 'REQUIRE_APPROVAL',
      reason: `Action of risk level ${riskLevel} on ${targetEnvironment ?? 'local'} requires approval.`,
      riskLevel,
      requiresTypedConfirmation: false,
    };
  }

  // Approval Required mode: READ_ONLY allowed, everything else requires approval
  if (riskLevel === 'READ_ONLY') {
    return {
      decision: 'ALLOW',
      reason: 'Read-only operation permitted.',
      riskLevel,
      requiresTypedConfirmation: false,
    };
  }

  return {
    decision: 'REQUIRE_APPROVAL',
    reason: `State-changing operation (${riskLevel}) requires user approval in Approval Required mode.`,
    riskLevel,
    requiresTypedConfirmation: false,
  };
}
