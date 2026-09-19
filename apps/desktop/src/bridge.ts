/**
 * Tauri IPC Command Bridge
 * Authoritative baseline defined in Master Specification §0.2 and M1.
 * Connects the React UI to native Rust commands with an in-memory fallback for headless tests.
 */

import {
  ServerProfile,
  AuditEvent,
  CredentialReference,
  SecretType,
  RiskLevel,
  ConnectionTestResult,
  HostKeyInfo,
  DiscoveredSshHost,
} from '@remote-commander/shared-types';
import { ToolDefinition } from '@remote-commander/tool-schema';

export interface AppInfo {
  name: string;
  version: string;
  default_ssh_port: number;
  default_whm_port: number;
}

export interface SettingRecord {
  key: string;
  value_json: string;
  updated_at: string;
}

export interface ApprovalRequest {
  id: string;
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  risk_level: RiskLevel;
  server_id?: string | undefined;
  server_name?: string | undefined;
  environment?: string | undefined;
  decision_reason: string;
  requires_typed_confirmation: boolean;
  typed_confirmation_prompt?: string | undefined;
  typed_confirmation_expected?: string | undefined;
  created_at: string;
  expires_at: string;
}

export interface ApprovalSubmission {
  approval_request_id: string;
  approved: boolean;
  typed_acknowledgement?: string | undefined;
  approved_by: string;
}

export interface ToolResult {
  call_id: string;
  success: boolean;
  stdout?: string | undefined;
  stderr?: string | undefined;
  exit_code?: number | undefined;
  data?: unknown;
  error?: string | undefined;
  truncated?: boolean | undefined;
  duration_ms: number;
}

export type ToolExecutionOutcome =
  | ({ type: 'executed' } & ToolResult)
  | ({ type: 'approval_required' } & ApprovalRequest)
  | { type: 'denied'; reason: string };

export interface ToolCallRecord {
  id: string;
  conversation_id?: string | undefined;
  server_id?: string | undefined;
  tool_name: string;
  arguments_json: string;
  risk_level: string;
  status: string;
  requested_at: string;
  approved_at?: string | undefined;
  approved_by?: string | undefined;
  started_at?: string | undefined;
  completed_at?: string | undefined;
  exit_code?: number | undefined;
  duration_ms?: number | undefined;
  stdout_summary?: string | undefined;
  stderr_summary?: string | undefined;
}

interface TauriServerRecord {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  environment: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION' | 'BACKUP' | 'OTHER';
  auth_method: 'SSH_KEY' | 'SSH_AGENT' | 'PASSWORD';
  credential_ref?: string;
  ssh_key_path?: string;
  ssh_config_alias?: string;
  cpanel_enabled: boolean;
  whm_port?: number;
  whm_token_ref?: string;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

interface TauriAuditEventRecord {
  id: string;
  timestamp: string;
  event_type:
    'TOOL_INVOKED' | 'TOOL_APPROVED' | 'TOOL_REJECTED' | 'TOOL_COMPLETED' | 'SECURITY_VIOLATION';
  server_id?: string;
  tool_name?: string;
  details_json: string;
}

interface TauriCredentialRefRecord {
  id: string;
  secret_type: string;
  label: string;
  created_at: string;
  last_used_at?: string;
}

// In-memory mock storage for browser testing / non-Tauri test environments
const mockCredentials = new Map<string, CredentialReference>([
  [
    'vault:ssh:prod-cpanel-01',
    {
      id: 'vault:ssh:prod-cpanel-01',
      type: 'SSH_KEY_PASSPHRASE',
      label: 'Production SSH Passphrase',
      createdAt: new Date().toISOString(),
    },
  ],
]);

const mockSettings = new Map<string, string>([
  ['permission_mode', '"SAFE_AUTOMATION"'],
  ['theme', '"dark"'],
  ['ai_provider', '"openai"'],
  ['ssh_host_key_checking', 'true'],
]);

const mockServers: ServerProfile[] = [
  {
    id: 'srv-prod-cpanel-01',
    name: 'production-cpanel-01',
    hostname: '198.51.100.15',
    port: 22,
    username: 'root',
    environment: 'PRODUCTION',
    authMethod: 'SSH_KEY',
    credentialRef: 'vault:ssh:prod-cpanel-01',
    sshKeyPath: '~/.ssh/id_ed25519',
    cpanelEnabled: true,
    whmPort: 2087,
    whmTokenRef: 'vault:whm:prod-cpanel-01',
    tags: ['web', 'cpanel', 'production'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'srv-staging-01',
    name: 'staging-app-01',
    hostname: '192.168.10.45',
    port: 22,
    username: 'deploy',
    environment: 'STAGING',
    authMethod: 'SSH_KEY',
    credentialRef: 'vault:ssh:staging-01',
    sshKeyPath: '~/.ssh/id_ed25519',
    cpanelEnabled: false,
    tags: ['docker', 'staging'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockAuditEvents: AuditEvent[] = [
  {
    id: 'evt-init-01',
    timestamp: new Date().toISOString(),
    eventType: 'TOOL_APPROVED',
    serverId: 'srv-prod-cpanel-01',
    toolName: 'server.service_status',
    detailsJson: JSON.stringify({ service: 'httpd', status: 'running' }),
  },
];

const mockToolCalls: ToolCallRecord[] = [];
const mockPendingApprovals: ApprovalRequest[] = [];

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  throw new Error('Not in Tauri environment');
}

export const Bridge = {
  async getAppInfo(): Promise<AppInfo> {
    try {
      return await invokeTauri<AppInfo>('get_app_info');
    } catch {
      return {
        name: 'RemoteCommander',
        version: '0.1.0',
        default_ssh_port: 22,
        default_whm_port: 2087,
      };
    }
  },

  async getSetting(key: string): Promise<string | null> {
    try {
      return await invokeTauri<string | null>('get_setting', { key });
    } catch {
      return mockSettings.get(key) ?? null;
    }
  },

  async setSetting(key: string, valueJson: string): Promise<void> {
    try {
      await invokeTauri<void>('set_setting', { key, valueJson });
    } catch {
      mockSettings.set(key, valueJson);
    }
  },

  async listSettings(): Promise<SettingRecord[]> {
    try {
      return await invokeTauri<SettingRecord[]>('list_settings');
    } catch {
      return Array.from(mockSettings.entries()).map(([key, value_json]) => ({
        key,
        value_json,
        updated_at: new Date().toISOString(),
      }));
    }
  },

  async listServers(): Promise<ServerProfile[]> {
    try {
      const records = await invokeTauri<TauriServerRecord[]>('list_servers');
      return records.map((r) => ({
        id: r.id,
        name: r.name,
        hostname: r.hostname,
        port: r.port,
        username: r.username,
        environment: r.environment,
        authMethod: r.auth_method,
        credentialRef: r.credential_ref,
        sshKeyPath: r.ssh_key_path,
        sshConfigAlias: r.ssh_config_alias,
        cpanelEnabled: r.cpanel_enabled,
        whmPort: r.whm_port,
        whmTokenRef: r.whm_token_ref,
        tags: JSON.parse(r.tags_json || '[]'),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } catch {
      return [...mockServers];
    }
  },

  async saveServer(server: ServerProfile): Promise<void> {
    try {
      await invokeTauri<void>('save_server', {
        server: {
          id: server.id,
          name: server.name,
          hostname: server.hostname,
          port: server.port,
          username: server.username,
          environment: server.environment,
          auth_method: server.authMethod,
          credential_ref: server.credentialRef ?? null,
          ssh_key_path: server.sshKeyPath ?? null,
          ssh_config_alias: server.sshConfigAlias ?? null,
          cpanel_enabled: server.cpanelEnabled,
          whm_port: server.whmPort ?? null,
          whm_token_ref: server.whmTokenRef ?? null,
          tags_json: JSON.stringify(server.tags),
          created_at: server.createdAt,
          updated_at: server.updatedAt,
        },
      });
    } catch {
      const idx = mockServers.findIndex((s) => s.id === server.id);
      if (idx >= 0) {
        mockServers[idx] = server;
      } else {
        mockServers.push(server);
      }
    }
  },

  async deleteServer(id: string): Promise<void> {
    try {
      await invokeTauri<void>('delete_server', { id });
    } catch {
      const idx = mockServers.findIndex((s) => s.id === id);
      if (idx >= 0) {
        mockServers.splice(idx, 1);
      }
    }
  },

  async listAuditEvents(limit = 100): Promise<AuditEvent[]> {
    try {
      const records = await invokeTauri<TauriAuditEventRecord[]>('list_audit_events', { limit });
      return records.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        eventType: r.event_type,
        serverId: r.server_id,
        toolName: r.tool_name,
        detailsJson: r.details_json,
      }));
    } catch {
      return [...mockAuditEvents].slice(0, limit);
    }
  },

  async recordAuditEvent(event: AuditEvent): Promise<void> {
    try {
      await invokeTauri<void>('record_audit_event', {
        event: {
          id: event.id,
          timestamp: event.timestamp,
          event_type: event.eventType,
          server_id: event.serverId ?? null,
          tool_name: event.toolName ?? null,
          details_json: event.detailsJson,
        },
      });
    } catch {
      mockAuditEvents.unshift(event);
    }
  },

  async saveSecret(
    secretType: SecretType,
    label: string,
    secretValue: string,
  ): Promise<CredentialReference> {
    try {
      const r = await invokeTauri<TauriCredentialRefRecord>('save_secret', {
        secretType,
        label,
        secretValue,
      });
      return {
        id: r.id,
        type: r.secret_type as SecretType,
        label: r.label,
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
      };
    } catch {
      const id = `cred:${secretType.toLowerCase()}:${Date.now()}`;
      const ref: CredentialReference = {
        id,
        type: secretType,
        label,
        createdAt: new Date().toISOString(),
      };
      mockCredentials.set(id, ref);
      return ref;
    }
  },

  async listCredentialRefs(): Promise<CredentialReference[]> {
    try {
      const records = await invokeTauri<TauriCredentialRefRecord[]>('list_credential_refs');
      return records.map((r) => ({
        id: r.id,
        type: r.secret_type as SecretType,
        label: r.label,
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
      }));
    } catch {
      return Array.from(mockCredentials.values());
    }
  },

  async deleteSecret(credentialRef: string): Promise<void> {
    try {
      await invokeTauri<void>('delete_secret', { credentialRef });
    } catch {
      mockCredentials.delete(credentialRef);
    }
  },

  async listToolDefinitions(): Promise<ToolDefinition[]> {
    try {
      return await invokeTauri<ToolDefinition[]>('list_tool_definitions');
    } catch {
      const { createDefaultToolRegistry } = await import('@remote-commander/tool-schema');
      return createDefaultToolRegistry().list();
    }
  },

  async evaluateAndExecuteTool(
    request: {
      id: string;
      tool_name: string;
      arguments: Record<string, unknown>;
      target_server_id?: string | undefined;
      conversation_id?: string | undefined;
    },
    permissionMode?: string,
  ): Promise<ToolExecutionOutcome> {
    try {
      return await invokeTauri<ToolExecutionOutcome>('evaluate_and_execute_tool', {
        request,
        permissionMode: permissionMode ?? null,
      });
    } catch (err: unknown) {
      if (!isTauriEnvironment()) {
        const record: ToolCallRecord = {
          id: request.id,
          conversation_id: request.conversation_id,
          server_id: request.target_server_id,
          tool_name: request.tool_name,
          arguments_json: JSON.stringify(request.arguments),
          risk_level: 'READ_ONLY',
          status: 'SUCCESS',
          requested_at: new Date().toISOString(),
          stdout_summary: 'Headless test fallback output',
        };
        mockToolCalls.unshift(record);

        if (request.tool_name === 'local.system_info') {
          return {
            type: 'executed',
            call_id: request.id,
            success: true,
            stdout: JSON.stringify({
              os: 'windows',
              family: 'windows',
              arch: 'x86_64',
              hostname: 'TEST-WORKSTATION',
              num_cpus: 8,
              uptime_seconds: 3600,
            }),
            duration_ms: 10,
          };
        }
        if (request.tool_name === 'local.list_directory') {
          return {
            type: 'executed',
            call_id: request.id,
            success: true,
            stdout: JSON.stringify(['package.json', 'src', 'README.md']),
            duration_ms: 5,
          };
        }
        if (request.tool_name === 'local.read_file') {
          return {
            type: 'executed',
            call_id: request.id,
            success: true,
            stdout: '{"name": "@remote-commander/desktop"}',
            duration_ms: 4,
          };
        }
        if (request.tool_name === 'local.process_list') {
          return {
            type: 'executed',
            call_id: request.id,
            success: true,
            stdout: JSON.stringify([
              { pid: 1024, name: 'remotecommander.exe', cpu_pct: 0.8, memory_kb: 51200 },
            ]),
            duration_ms: 8,
          };
        }
        if (request.tool_name === 'ssh.execute') {
          const cmd = String(request.arguments.command ?? '').trim();
          const targetSrv =
            request.target_server_id ?? String(request.arguments.server_id ?? 'production01');

          // Heuristic destructive check (Gate D, Master Spec §9 M6)
          const isDestructive =
            cmd.includes('rm -rf') ||
            cmd.includes('mkfs') ||
            cmd.includes('dd ') ||
            cmd.includes('drop table') ||
            cmd.includes('iptables -F');

          if (isDestructive) {
            const approval: ApprovalRequest = {
              id: `appr-${request.id}`,
              tool_call_id: request.id,
              tool_name: request.tool_name,
              arguments: request.arguments,
              risk_level: 'CRITICAL',
              server_id: targetSrv,
              server_name: targetSrv,
              environment: 'PRODUCTION',
              decision_reason: 'CRITICAL: Destructive command heuristic detected',
              requires_typed_confirmation: true,
              typed_confirmation_prompt: `CRITICAL ACTION: DESTRUCTIVE_COMMAND\nServer: ${targetSrv} (PRODUCTION)\nType '${targetSrv}' to confirm execution.`,
              typed_confirmation_expected: targetSrv,
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 300000).toISOString(),
            };
            mockPendingApprovals.unshift(approval);
            return {
              type: 'approval_required',
              ...approval,
            };
          }

          // Safe diagnostic command or regular command
          let stdout = '';
          let truncated = false;
          if (cmd.includes('huge_output') || cmd.includes('generate_large_output')) {
            const pattern = 'Telemetry sample line 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ\n';
            const raw = pattern.repeat(1000);
            stdout = raw.slice(0, 50_000) + '\n... [OUTPUT TRUNCATED AT 50,000 CHARACTERS]';
            truncated = true;
          } else if (cmd.includes('uptime') && cmd.includes('df')) {
            stdout =
              ' 14:35:12 up 58 days, 4:12,  1 user,  load average: 0.18, 0.12, 0.08\n\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1   50G   19G   31G  38% /\ntmpfs           3.9G     0  3.9G   0% /dev/shm\n/dev/nvme0n1p2  200G   82G  118G  41% /var\n';
          } else if (cmd.includes('uptime')) {
            stdout = ' 14:35:12 up 58 days, 4:12,  1 user,  load average: 0.18, 0.12, 0.08\n';
          } else if (cmd.includes('df')) {
            stdout =
              'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1   50G   19G   31G  38% /\ntmpfs           3.9G     0  3.9G   0% /dev/shm\n';
          } else if (cmd.includes('uname')) {
            stdout = `Linux ${targetSrv} 5.15.0-101-generic #111-Ubuntu SMP Wed Jan 10 12:00:00 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux\n`;
          } else {
            stdout = `Remote command completed on ${targetSrv}: ${cmd}\n`;
          }

          return {
            type: 'executed',
            call_id: request.id,
            success: true,
            stdout,
            exit_code: 0,
            truncated,
            duration_ms: 25,
            data: {
              server_id: targetSrv,
              command: cmd,
              truncated,
            },
          };
        }
        if (
          request.tool_name.startsWith('admin.') ||
          request.tool_name.startsWith('server.reboot')
        ) {
          const approval: ApprovalRequest = {
            id: `appr-${request.id}`,
            tool_call_id: request.id,
            tool_name: request.tool_name,
            arguments: request.arguments,
            risk_level: 'HIGH',
            decision_reason: 'Requires operator authorization',
            requires_typed_confirmation: true,
            typed_confirmation_prompt: 'Type confirmation to execute',
            typed_confirmation_expected: 'CONFIRM',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 300000).toISOString(),
          };
          mockPendingApprovals.unshift(approval);
          return {
            type: 'approval_required',
            ...approval,
          };
        }
      }
      return {
        type: 'denied',
        reason: (err as Error)?.message ?? String(err),
      };
    }
  },

  async submitApproval(submission: ApprovalSubmission): Promise<ToolResult> {
    try {
      return await invokeTauri<ToolResult>('submit_approval', { submission });
    } catch (err: unknown) {
      if (!isTauriEnvironment()) {
        const idx = mockPendingApprovals.findIndex((a) => a.id === submission.approval_request_id);
        if (idx >= 0) {
          mockPendingApprovals.splice(idx, 1);
        }
        return {
          call_id: submission.approval_request_id,
          success: submission.approved,
          stdout: submission.approved
            ? 'Approved and executed successfully in test fallback'
            : undefined,
          error: submission.approved ? undefined : 'Approval rejected by operator',
          duration_ms: 5,
        };
      }
      return {
        call_id: submission.approval_request_id,
        success: false,
        error: (err as Error)?.message ?? String(err),
        duration_ms: 0,
      };
    }
  },

  async listPendingApprovals(): Promise<ApprovalRequest[]> {
    try {
      return await invokeTauri<ApprovalRequest[]>('list_pending_approvals');
    } catch {
      return [...mockPendingApprovals];
    }
  },

  async listToolCalls(limit = 100): Promise<ToolCallRecord[]> {
    try {
      return await invokeTauri<ToolCallRecord[]>('list_tool_calls', { limit });
    } catch {
      return [...mockToolCalls].slice(0, limit);
    }
  },

  async testServerConnection(serverId: string): Promise<ConnectionTestResult> {
    try {
      return await invokeTauri<ConnectionTestResult>('test_server_connection', { serverId });
    } catch {
      // Headless / mock test fallback
      const srv = mockServers.find((s) => s.id === serverId);
      const isMitm = serverId.includes('mitm') || srv?.name.includes('mitm');
      if (isMitm) {
        return {
          success: false,
          serverId,
          serverName: srv?.name ?? 'mitm-server',
          hostname: srv?.hostname ?? '198.51.100.99',
          port: srv?.port ?? 22,
          username: srv?.username ?? 'root',
          hostKeyStatus: 'CHANGED_WARNING',
          previousFingerprint: 'SHA256:InitialTrustedFingerprint1234567890abcdef',
          newFingerprint: 'SHA256:RogueAttackerFingerprint9876543210fedcba',
          latencyMs: 12,
          errorMessage:
            'CRITICAL SECURITY WARNING: Remote host identification has changed! Possible man-in-the-middle attack or server rebuild.',
        };
      }
      return {
        success: true,
        serverId,
        serverName: srv?.name ?? 'mock-server',
        hostname: srv?.hostname ?? '198.51.100.15',
        port: srv?.port ?? 22,
        username: srv?.username ?? 'root',
        hostKey: {
          keyType: 'ssh-ed25519',
          publicKeyBase64: 'AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z3m',
          fingerprintSha256: 'SHA256:4t7XhE69e1PZ8j/0dGvKk3n1m7o9p5q8r2s4t6u8v0w',
        },
        hostKeyStatus: 'TRUSTED',
        latencyMs: 16,
        serverVersionBanner: 'SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3',
      };
    }
  },

  async acceptServerHostKey(serverId: string, hostKey: HostKeyInfo): Promise<void> {
    try {
      await invokeTauri<void>('accept_server_host_key', { serverId, hostKey });
    } catch {
      // Mock acceptance in headless mode
    }
  },

  async listDiscoveredSshConfigHosts(): Promise<DiscoveredSshHost[]> {
    try {
      return await invokeTauri<DiscoveredSshHost[]>('list_discovered_ssh_config_hosts');
    } catch {
      return [
        {
          alias: 'bastion',
          hostname: '192.168.1.1',
          port: 22,
          username: 'admin',
          identityFile: '~/.ssh/id_ed25519',
        },
        {
          alias: 'staging-k8s',
          hostname: '10.0.1.50',
          port: 2222,
          username: 'deploy',
          proxyJump: 'bastion',
        },
      ];
    }
  },

  async listKnownHosts(): Promise<unknown[]> {
    try {
      return await invokeTauri<unknown[]>('list_known_hosts');
    } catch {
      return [];
    }
  },
};
