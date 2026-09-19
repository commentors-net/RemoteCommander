/**
 * Target server environment types.
 * Authoritative baseline defined in Master Specification §0.8 and §22.
 */
export type ServerEnvironment = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION' | 'BACKUP' | 'OTHER';

export type AuthMethod = 'SSH_KEY' | 'SSH_AGENT' | 'PASSWORD';

export interface ServerProfile {
  id: string; // Stable internal server_id (UUID or slug)
  name: string;
  hostname: string;
  port: number;
  username: string;
  environment: ServerEnvironment;
  authMethod: AuthMethod;
  credentialRef?: string | undefined; // Opaque reference to OS keyring secret (NEVER raw secret)
  sshKeyPath?: string | undefined;
  sshConfigAlias?: string | undefined;
  cpanelEnabled: boolean;
  whmPort?: number | undefined;
  whmTokenRef?: string | undefined; // Opaque reference to WHM API token
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  tags: string[];
}

export interface HostKeyInfo {
  keyType: string; // e.g. 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-rsa'
  publicKeyBase64: string;
  fingerprintSha256: string; // e.g. 'SHA256:abc...'
}

export type HostKeyStatus =
  | { status: 'TRUSTED' }
  | { status: 'NEW_HOST'; hostKey: HostKeyInfo }
  | {
      status: 'CHANGED_WARNING';
      previousFingerprint: string;
      newFingerprint: string;
      newKeyType: string;
    }
  | { status: 'REVOKED' };

export interface ConnectionTestResult {
  success: boolean;
  serverId: string;
  serverName: string;
  hostname: string;
  port: number;
  username: string;
  hostKey?: HostKeyInfo | undefined;
  hostKeyStatus: 'TRUSTED' | 'NEW_HOST' | 'CHANGED_WARNING' | 'REVOKED' | 'UNVERIFIED';
  previousFingerprint?: string | undefined;
  newFingerprint?: string | undefined;
  latencyMs: number;
  serverVersionBanner?: string | undefined;
  errorMessage?: string | undefined;
}

export interface DiscoveredSshHost {
  alias: string;
  hostname: string;
  port: number;
  username?: string | undefined;
  identityFile?: string | undefined;
  proxyJump?: string | undefined;
}
