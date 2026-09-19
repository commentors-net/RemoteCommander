import { describe, it, expect } from 'vitest';
import { DESKTOP_VERSION, SUPPORTED_VIEWS } from './index.js';
import { Bridge } from './bridge.js';
import { ServerProfile, AuditEvent } from '@remote-commander/shared-types';
import { MockAIProvider, ToolLoopOrchestrator } from '@remote-commander/ai-core';

describe('Desktop Shell & Navigation Views', () => {
  it('defines desktop version and all required views', () => {
    expect(DESKTOP_VERSION).toBe('0.1.0');
    expect(SUPPORTED_VIEWS).toEqual([
      'Chat',
      'Servers',
      'Terminal',
      'Files',
      'Activity',
      'Settings',
    ]);
  });
});

describe('Tauri Bridge & Local Persistence', () => {
  it('loads app info', async () => {
    const info = await Bridge.getAppInfo();
    expect(info.name).toBe('RemoteCommander');
    expect(info.default_ssh_port).toBe(22);
    expect(info.default_whm_port).toBe(2087);
  });

  it('persists and retrieves non-secret application settings', async () => {
    await Bridge.setSetting('theme', JSON.stringify('dark'));
    const theme = await Bridge.getSetting('theme');
    expect(theme).toBe(JSON.stringify('dark'));

    await Bridge.setSetting('permission_mode', JSON.stringify('APPROVAL_REQUIRED'));
    const mode = await Bridge.getSetting('permission_mode');
    expect(mode).toBe(JSON.stringify('APPROVAL_REQUIRED'));
  });

  it('manages server inventory profiles', async () => {
    const initialServers = await Bridge.listServers();
    expect(initialServers.length).toBeGreaterThanOrEqual(1);

    const newServer: ServerProfile = {
      id: 'srv-test-001',
      name: 'test-vps',
      hostname: '10.0.0.99',
      port: 22,
      username: 'admin',
      environment: 'STAGING',
      authMethod: 'SSH_KEY',
      credentialRef: 'vault:ssh:test-vps',
      sshKeyPath: '~/.ssh/id_ed25519',
      cpanelEnabled: false,
      tags: ['test'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await Bridge.saveServer(newServer);
    const serversAfterAdd = await Bridge.listServers();
    const found = serversAfterAdd.find((s) => s.id === 'srv-test-001');
    expect(found).toBeDefined();
    expect(found?.name).toBe('test-vps');
    expect(found?.credentialRef).toBe('vault:ssh:test-vps');

    await Bridge.deleteServer('srv-test-001');
    const serversAfterDel = await Bridge.listServers();
    expect(serversAfterDel.find((s) => s.id === 'srv-test-001')).toBeUndefined();
  });

  it('records and queries audit events', async () => {
    const event: AuditEvent = {
      id: 'evt-test-99',
      timestamp: new Date().toISOString(),
      eventType: 'TOOL_INVOKED',
      serverId: 'srv-prod-cpanel-01',
      toolName: 'server.disk_usage',
      detailsJson: JSON.stringify({ disk: '/dev/sda1', usage: '45%' }),
    };

    await Bridge.recordAuditEvent(event);
    const events = await Bridge.listAuditEvents(10);
    const matched = events.find((e) => e.id === 'evt-test-99');
    expect(matched).toBeDefined();
    expect(matched?.toolName).toBe('server.disk_usage');
  });

  it('securely saves, lists, and deletes secrets in the OS keyring bridge', async () => {
    const rawSecret = 'secret-token-payload-xyz-123';
    const ref = await Bridge.saveSecret('AI_API_KEY', 'OpenAI Production Key', rawSecret);

    expect(ref.id.startsWith('cred:ai_api_key:')).toBe(true);
    expect(ref.label).toBe('OpenAI Production Key');
    expect(ref.type).toBe('AI_API_KEY');

    // Security Gate A verification: raw secret is NEVER in the returned CredentialReference
    expect(Object.values(ref)).not.toContain(rawSecret);

    const list = await Bridge.listCredentialRefs();
    const found = list.find((c) => c.id === ref.id);
    expect(found).toBeDefined();
    expect(found?.label).toBe('OpenAI Production Key');

    await Bridge.deleteSecret(ref.id);
    const listAfterDelete = await Bridge.listCredentialRefs();
    expect(listAfterDelete.find((c) => c.id === ref.id)).toBeUndefined();
  });

  it('queries tool definitions from registry', async () => {
    const tools = await Bridge.listToolDefinitions();
    expect(tools.length).toBeGreaterThanOrEqual(1);
    const sysInfo = tools.find((t) => t.name === 'local.system_info');
    expect(sysInfo).toBeDefined();
    expect(sysInfo?.risk).toBe('READ_ONLY');
  });

  it('supports tool execution, approvals, and listing tool calls', async () => {
    const outcome = await Bridge.evaluateAndExecuteTool({
      id: 'test-call-01',
      tool_name: 'local.system_info',
      arguments: {},
    });

    expect(outcome.type).toBeDefined();

    const pending = await Bridge.listPendingApprovals();
    expect(Array.isArray(pending)).toBe(true);

    const toolCalls = await Bridge.listToolCalls();
    expect(Array.isArray(toolCalls)).toBe(true);
  });
});

describe('Milestone M4: Local AI + Tool Loop Integration', () => {
  it('executes M4 scenario: user query invokes local tool and returns grounded answer', async () => {
    const provider = new MockAIProvider();
    const tools = await Bridge.listToolDefinitions();
    const orchestrator = new ToolLoopOrchestrator(provider, tools);

    const steps: string[] = [];
    const result = await orchestrator.run(
      [{ role: 'user', content: 'What operating system am I running?' }],
      'mock-gpt-4o',
      async (call) => {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(call.argumentsJson);
        } catch {
          parsedArgs = {};
        }
        const outcome = await Bridge.evaluateAndExecuteTool({
          id: call.id,
          tool_name: call.toolName,
          arguments: parsedArgs,
          conversation_id: 'test-m4-conv',
        });
        if (outcome.type === 'executed') {
          return {
            success: outcome.success,
            output: outcome.stdout ?? 'Done',
          };
        }
        return {
          success: false,
          output: outcome.type === 'denied' ? outcome.reason : 'Approval required',
        };
      },
      {
        onStep: (step) => steps.push(step.type),
      },
    );

    // Verify multi-turn steps occurred
    expect(steps).toContain('TOOL_REQUESTED');
    expect(steps).toContain('TOOL_EXECUTED');
    expect(steps).toContain('FINAL_ANSWER');

    // Verify grounded final text incorporates system details
    expect(result.finalText).toContain('workstation environment');
    expect(result.cancelled).toBe(false);

    // Verify tool call was recorded in bridge audit
    const toolCalls = await Bridge.listToolCalls();
    const sysInfoCall = toolCalls.find((c) => c.tool_name === 'local.system_info');
    expect(sysInfoCall).toBeDefined();
  });

  it('handles approval-required tools and allows operator approval submission', async () => {
    const outcome = await Bridge.evaluateAndExecuteTool({
      id: 'call-dangerous-01',
      tool_name: 'admin.server.reboot',
      arguments: { server_id: 'srv-prod-cpanel-01' },
    });

    expect(outcome.type).toBe('approval_required');
    if (outcome.type === 'approval_required') {
      expect(outcome.requires_typed_confirmation).toBe(true);
      expect(outcome.risk_level).toBe('HIGH');

      const pending = await Bridge.listPendingApprovals();
      expect(pending.some((p) => p.id === outcome.id)).toBe(true);

      const approvalResult = await Bridge.submitApproval({
        approval_request_id: outcome.id,
        approved: true,
        typed_acknowledgement: 'CONFIRM',
        approved_by: 'operator@local',
      });

      expect(approvalResult.success).toBe(true);

      const pendingAfter = await Bridge.listPendingApprovals();
      expect(pendingAfter.some((p) => p.id === outcome.id)).toBe(false);
    }
  });

  it('supports cancellation of in-flight loop via AbortController', async () => {
    const provider = new MockAIProvider();
    const tools = await Bridge.listToolDefinitions();
    const orchestrator = new ToolLoopOrchestrator(provider, tools);

    const controller = new AbortController();
    controller.abort();

    const result = await orchestrator.run(
      [{ role: 'user', content: 'What operating system am I running?' }],
      'mock-gpt-4o',
      async () => ({ success: true, output: 'ok' }),
      {},
      controller.signal,
    );

    expect(result.cancelled).toBe(true);
  });
});

describe('Milestone M5: Server Inventory & SSH Transport Integration', () => {
  it('saves and retrieves server profile with sshConfigAlias and extended environments', async () => {
    const server: ServerProfile = {
      id: 'srv-m5-backup-01',
      name: 'backup-vault-01',
      hostname: '10.0.100.25',
      port: 22,
      username: 'backupuser',
      environment: 'BACKUP',
      authMethod: 'SSH_KEY',
      credentialRef: 'vault:ssh:backup-vault-01',
      sshKeyPath: '~/.ssh/id_ed25519',
      sshConfigAlias: 'backup-nas',
      cpanelEnabled: false,
      tags: ['backup', 'storage'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await Bridge.saveServer(server);
    const list = await Bridge.listServers();
    const found = list.find((s) => s.id === 'srv-m5-backup-01');

    expect(found).toBeDefined();
    expect(found?.environment).toBe('BACKUP');
    expect(found?.sshConfigAlias).toBe('backup-nas');

    await Bridge.deleteServer('srv-m5-backup-01');
  });

  it('executes M5 acceptance scenario: Test Connection returns host, user, fingerprint, and status', async () => {
    const servers = await Bridge.listServers();
    expect(servers.length).toBeGreaterThan(0);
    const target = servers[0]!;

    const result = await Bridge.testServerConnection(target.id);

    // M5 Acceptance Criteria Verification
    expect(result.success).toBe(true);
    expect(result.hostname).toBeDefined();
    expect(result.username).toBe(target.username);
    expect(result.hostKeyStatus).toBe('TRUSTED');
    expect(result.hostKey?.fingerprintSha256).toMatch(/^SHA256:/);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.serverVersionBanner).toContain('SSH');
  });

  it('enforces Security Gate E: host key fingerprint mismatch triggers CHANGED_WARNING and blocks', async () => {
    // Testing MITM / altered key scenario
    const mitmServer: ServerProfile = {
      id: 'srv-test-mitm-01',
      name: 'test-mitm-target',
      hostname: '198.51.100.99',
      port: 22,
      username: 'root',
      environment: 'PRODUCTION',
      authMethod: 'SSH_KEY',
      cpanelEnabled: false,
      tags: ['test', 'mitm'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await Bridge.saveServer(mitmServer);

    const probeResult = await Bridge.testServerConnection(mitmServer.id);

    // Gate E: Connection MUST be rejected and flagged
    expect(probeResult.success).toBe(false);
    expect(probeResult.hostKeyStatus).toBe('CHANGED_WARNING');
    expect(probeResult.previousFingerprint).toBeDefined();
    expect(probeResult.newFingerprint).toBeDefined();
    expect(probeResult.previousFingerprint).not.toBe(probeResult.newFingerprint);
    expect(probeResult.errorMessage).toContain('CRITICAL SECURITY WARNING');

    await Bridge.deleteServer(mitmServer.id);
  });

  it('discovers host aliases from user ~/.ssh/config', async () => {
    const discovered = await Bridge.listDiscoveredSshConfigHosts();
    expect(Array.isArray(discovered)).toBe(true);
    expect(discovered.length).toBeGreaterThan(0);
    expect(discovered[0]?.alias).toBeDefined();
    expect(discovered[0]?.hostname).toBeDefined();
  });

  it('allows accepting and persisting host keys', async () => {
    await Bridge.acceptServerHostKey('srv-prod-cpanel-01', {
      keyType: 'ssh-ed25519',
      publicKeyBase64: 'AAAAC3NzaC1lZDI1NTE5AAAAIGV0/Qx0XyXp6sMlhVv1xNlE0qZ0P4g8Xy7+m2Wk0Z3m',
      fingerprintSha256: 'SHA256:4t7XhE69e1PZ8j/0dGvKk3n1m7o9p5q8r2s4t6u8v0w',
    });

    const knownHosts = await Bridge.listKnownHosts();
    expect(Array.isArray(knownHosts)).toBe(true);
  });
});

describe('Milestone M6: Remote Command Execution & Diagnostics', () => {
  it('executes M6 acceptance scenario: Check uptime and disk usage on production01', async () => {
    const provider = new MockAIProvider();
    const tools = await Bridge.listToolDefinitions();
    const orchestrator = new ToolLoopOrchestrator(provider, tools);

    const history = [
      {
        role: 'user' as const,
        content: 'Check uptime and disk usage on production01.',
      },
    ];

    let executedToolName = '';
    let executedToolArgs = '';
    let executedToolOutput = '';

    const outcome = await orchestrator.run(history, 'mock-gpt-4o', async (call) => {
      executedToolName = call.toolName;
      executedToolArgs = call.argumentsJson;

      const res = await Bridge.evaluateAndExecuteTool({
        id: call.id,
        tool_name: call.toolName,
        arguments: JSON.parse(call.argumentsJson),
        target_server_id: 'production01',
      });

      if (res.type === 'executed') {
        executedToolOutput = res.stdout ?? '';
        return {
          success: res.success,
          output: res.stdout ?? '',
        };
      }
      return { success: false, output: 'Approval required' };
    });

    // Verify AI invoked ssh.execute with target and command
    expect(executedToolName).toBe('ssh.execute');
    expect(executedToolArgs).toContain('uptime && df -h');
    expect(executedToolArgs).toContain('production01');

    // Verify output contains telemetry
    expect(executedToolOutput).toContain('load average');
    expect(executedToolOutput).toContain('Filesystem');

    // Verify grounded AI synthesis citing the telemetry
    expect(outcome.finalText).toContain('Based on remote diagnostics executed on production01:');
    expect(outcome.finalText).toContain('load average');
    expect(outcome.finalText).toContain('31G available');
    expect(outcome.iterations).toBe(2);
  });

  it('enforces 50,000 characters output limit with truncated: true', async () => {
    const res = await Bridge.evaluateAndExecuteTool({
      id: 'test-trunc-1',
      tool_name: 'ssh.execute',
      arguments: {
        server_id: 'production01',
        command: 'generate_large_output',
      },
      target_server_id: 'production01',
    });

    expect(res.type).toBe('executed');
    if (res.type === 'executed') {
      expect(res.success).toBe(true);
      expect(res.truncated).toBe(true);
      expect(res.stdout).toContain('[OUTPUT TRUNCATED AT 50,000 CHARACTERS]');
    }
  });

  it('detects destructive command heuristics and escalates to CRITICAL typed confirmation', async () => {
    const res = await Bridge.evaluateAndExecuteTool({
      id: 'test-destr-1',
      tool_name: 'ssh.execute',
      arguments: {
        server_id: 'production01',
        command: 'rm -rf /var/www/html',
      },
      target_server_id: 'production01',
    });

    expect(res.type).toBe('approval_required');
    if (res.type === 'approval_required') {
      expect(res.risk_level).toBe('CRITICAL');
      expect(res.requires_typed_confirmation).toBe(true);
      expect(res.typed_confirmation_expected).toBe('production01');
      expect(res.typed_confirmation_prompt).toContain("Type 'production01' to confirm execution.");
    }
  });

  it('auto-allows safe read-only diagnostics without approval fatigue', async () => {
    const res = await Bridge.evaluateAndExecuteTool({
      id: 'test-diag-allow-1',
      tool_name: 'ssh.execute',
      arguments: {
        server_id: 'production01',
        command: 'uptime && df -h',
      },
      target_server_id: 'production01',
    });

    // M6 DoD: safe read-only diagnostics evaluate as ReadOnly and auto-execute!
    expect(res.type).toBe('executed');
    if (res.type === 'executed') {
      expect(res.success).toBe(true);
      expect(res.exit_code).toBe(0);
      expect(res.stdout).toContain('load average');
    }
  });
});
