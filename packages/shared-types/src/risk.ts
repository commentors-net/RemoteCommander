/**
 * Risk classification for all operations.
 * Authoritative baseline defined in Master Specification §0.5 and §11.
 */
export type RiskLevel = 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const RiskLevels: Record<RiskLevel, RiskLevel> = {
  READ_ONLY: 'READ_ONLY',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export const RiskOrder: Record<RiskLevel, number> = {
  READ_ONLY: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
} as const;

export function isMoreRiskyThan(a: RiskLevel, b: RiskLevel): boolean {
  return RiskOrder[a] > RiskOrder[b];
}
