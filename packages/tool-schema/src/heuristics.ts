/**
 * Destructive-command heuristics scanner.
 * Authoritative baseline defined in Master Specification §0.4, §10A, and §11.
 *
 * NOTE: Regex scanning is defense-in-depth ONLY and is NOT a complete security boundary.
 * All operations pass through the policy engine regardless of regex matching.
 */

export interface HeuristicScanResult {
  flagged: boolean;
  patternsMatched: string[];
  suggestedRiskLevel: 'CRITICAL' | 'HIGH' | null;
  rationale?: string | undefined;
}

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; name: string; risk: 'CRITICAL' | 'HIGH' }> = [
  {
    pattern: /\brm\s+-[rfR]{1,3}\s+(?:\/|\/\*|~|\$HOME|\.\.)(?:\s|$)/i,
    name: 'ROOT_OR_HOME_RECURSIVE_DELETION',
    risk: 'CRITICAL',
  },
  {
    pattern: /\b(mkfs|wipefs|parted|fdisk|cfdisk|sfdisk)\b/i,
    name: 'FILESYSTEM_OR_PARTITION_FORMAT',
    risk: 'CRITICAL',
  },
  {
    pattern: /\bdd\s+if=.*?of=\/dev\/(?:sd[a-z]|nvme\d+n\d+|vd[a-z])/i,
    name: 'RAW_BLOCK_DEVICE_WRITE',
    risk: 'CRITICAL',
  },
  {
    pattern: /\bDROP\s+(?:DATABASE|SCHEMA)\b/i,
    name: 'DATABASE_DROP',
    risk: 'CRITICAL',
  },
  {
    pattern:
      /\b(ufw\s+disable|iptables\s+-F|nft\s+flush\s+ruleset|systemctl\s+stop\s+firewalld)\b/i,
    name: 'FIREWALL_DISABLE',
    risk: 'CRITICAL',
  },
  {
    pattern: /\b(userdel\s+-r\s+root|passwd\s+-d\s+root)\b/i,
    name: 'ROOT_USER_TAMPERING',
    risk: 'CRITICAL',
  },
  {
    pattern: /\bchmod\s+-[rR]\s+777\s+(?:\/|\/etc|\/var|\/usr)\b/i,
    name: 'MASS_SYSTEM_PERMISSION_OVERWRITE',
    risk: 'HIGH',
  },
  {
    pattern: /\bTRUNCATE\s+TABLE\b/i,
    name: 'TABLE_TRUNCATE',
    risk: 'HIGH',
  },
];

export function scanCommandHeuristics(command: string): HeuristicScanResult {
  const matchedPatterns: string[] = [];
  let highestRisk: 'CRITICAL' | 'HIGH' | null = null;

  for (const { pattern, name, risk } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      matchedPatterns.push(name);
      if (risk === 'CRITICAL' || highestRisk === null) {
        highestRisk = risk;
      }
    }
  }

  return {
    flagged: matchedPatterns.length > 0,
    patternsMatched: matchedPatterns,
    suggestedRiskLevel: highestRisk,
    rationale:
      matchedPatterns.length > 0
        ? `Command matches destructive heuristics: ${matchedPatterns.join(', ')}`
        : undefined,
  };
}
