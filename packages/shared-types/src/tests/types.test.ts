import { describe, it, expect } from 'vitest';
import { RiskLevels, isMoreRiskyThan, evaluatePolicy, PolicyEvaluationRequest } from '../index.js';

describe('Risk Levels', () => {
  it('correctly ranks risk levels', () => {
    expect(isMoreRiskyThan(RiskLevels.CRITICAL, RiskLevels.HIGH)).toBe(true);
    expect(isMoreRiskyThan(RiskLevels.HIGH, RiskLevels.MEDIUM)).toBe(true);
    expect(isMoreRiskyThan(RiskLevels.MEDIUM, RiskLevels.LOW)).toBe(true);
    expect(isMoreRiskyThan(RiskLevels.LOW, RiskLevels.READ_ONLY)).toBe(true);
    expect(isMoreRiskyThan(RiskLevels.READ_ONLY, RiskLevels.CRITICAL)).toBe(false);
  });
});

describe('Policy Evaluation', () => {
  it('allows read-only tools automatically in Approval Required mode', () => {
    const req: PolicyEvaluationRequest = {
      toolName: 'server.disk_usage',
      riskLevel: 'READ_ONLY',
      mode: 'APPROVAL_REQUIRED',
      isDestructiveHeuristicFlagged: false,
    };
    const decision = evaluatePolicy(req);
    expect(decision.decision).toBe('ALLOW');
  });

  it('requires approval for state-changing operations in Approval Required mode', () => {
    const req: PolicyEvaluationRequest = {
      toolName: 'ssh.execute',
      riskLevel: 'MEDIUM',
      mode: 'APPROVAL_REQUIRED',
      isDestructiveHeuristicFlagged: false,
    };
    const decision = evaluatePolicy(req);
    expect(decision.decision).toBe('REQUIRE_APPROVAL');
  });

  it('enforces typed confirmation for CRITICAL operations even in Full Access mode', () => {
    const req: PolicyEvaluationRequest = {
      toolName: 'ssh.execute',
      riskLevel: 'CRITICAL',
      mode: 'FULL_ACCESS',
      isDestructiveHeuristicFlagged: false,
    };
    const decision = evaluatePolicy(req);
    expect(decision.decision).toBe('REQUIRE_TYPED_CONFIRMATION');
    expect(decision.requiresTypedConfirmation).toBe(true);
  });

  it('enforces typed confirmation when destructive heuristic is flagged', () => {
    const req: PolicyEvaluationRequest = {
      toolName: 'ssh.execute',
      riskLevel: 'LOW',
      mode: 'FULL_ACCESS',
      isDestructiveHeuristicFlagged: true,
    };
    const decision = evaluatePolicy(req);
    expect(decision.decision).toBe('REQUIRE_TYPED_CONFIRMATION');
    expect(decision.requiresTypedConfirmation).toBe(true);
  });
});
