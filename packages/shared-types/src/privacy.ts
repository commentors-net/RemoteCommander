/**
 * Privacy, Data Controls & Prompt-Injection Hardening Types
 * Authoritative baseline defined in Master Specification §17 (M14), §27, and §29.
 */

export interface PrivacySettings {
  /** When enabled, raw file contents and raw server logs are sanitized/masked before sending to AI */
  restrictedDataMode: boolean;
  /** Automatically redact API keys, passwords, authorization tokens, and private keys */
  secretRedactionEnabled: boolean;
  /** Maximum character length per tool output before truncation */
  maxCharsPerToolOutput: number;
  /** Maximum number of log lines sent per excerpt */
  maxLogLinesPerExcerpt: number;
  /** Days to retain activity and audit history (0 = indefinite) */
  historyRetentionDays: number;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  restrictedDataMode: false,
  secretRedactionEnabled: true,
  maxCharsPerToolOutput: 50_000,
  maxLogLinesPerExcerpt: 100,
  historyRetentionDays: 30,
};

export type RedactionCategory =
  'API_KEY' | 'AUTH_HEADER' | 'PASSWORD' | 'PRIVATE_KEY' | 'TOKEN' | 'COOKIE';

export interface RedactionMatch {
  category: RedactionCategory;
  count: number;
}

export interface RedactionResult {
  redactedText: string;
  hasRedactions: boolean;
  totalRedactions: number;
  categories: RedactionCategory[];
}

export interface SanitizedContentResult {
  content: string;
  originalBytes: number;
  sanitizedBytes: number;
  isTruncated: boolean;
  isRestrictedMode: boolean;
  redactionResult: RedactionResult;
}

export interface ProviderDisclosureInfo {
  providerId: string;
  isLocal: boolean;
  dataLeavesDevice: boolean;
  destinationSummary: string;
  privacyNotice: string;
}
