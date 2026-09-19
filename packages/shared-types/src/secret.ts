/**
 * Credential reference and secret types.
 * Authoritative baseline defined in Master Specification §0.10, §0.13 Gate A, and ADR 0003.
 * Raw secrets are NEVER stored in SQLite, memory persistence, or model context.
 */
export type SecretType =
  'AI_API_KEY' | 'SSH_PASSWORD' | 'SSH_KEY_PASSPHRASE' | 'WHM_API_TOKEN' | 'GENERIC_TOKEN';

export interface CredentialReference {
  id: string; // Opaque reference ID stored in SQLite (e.g., 'cred:ssh:prod1')
  type: SecretType;
  label: string;
  createdAt: string;
  lastUsedAt?: string | undefined;
}
