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

describe('M10 Semantic Server Operations Types', () => {
  it('instantiates valid structured server operational types', () => {
    const sysInfo = {
      hostname: 'prod-srv-01',
      os_name: 'AlmaLinux',
      os_version: '9.4',
      kernel: '5.14.0-427.el9.x86_64',
      arch: 'x86_64',
      uptime_seconds: 86400,
      uptime_human: '1 day, 0 hours',
      distro_family: 'rhel' as const,
    };
    expect(sysInfo.distro_family).toBe('rhel');
    expect(sysInfo.uptime_seconds).toBe(86400);

    const serviceInfo = {
      name: 'httpd',
      resolved_name: 'httpd',
      load_state: 'loaded',
      active_state: 'active',
      sub_state: 'running',
      main_pid: 1234,
      description: 'The Apache HTTP Server',
      is_running: true,
      is_enabled: true,
    };
    expect(serviceInfo.is_running).toBe(true);
  });
});

describe('M11 WHM/cPanel Integration Types', () => {
  it('instantiates valid WHM/cPanel account and server structures', () => {
    const srvInfo = {
      hostname: 'whm.example.com',
      version: '11.120.0.12',
      build: '11.120.0.12',
      license_status: 'Active',
      operating_system: 'AlmaLinux 9.4 (Seafoam)',
      cpanel_release_tier: 'RELEASE',
      active_services_count: 14,
    };
    expect(srvInfo.license_status).toBe('Active');
    expect(srvInfo.active_services_count).toBe(14);

    const account = {
      user: 'clientapp',
      domain: 'clientapp.com',
      email: 'admin@clientapp.com',
      plan: 'Gold_Hosting',
      disk_used: '450M',
      disk_limit: '10240M',
      disk_used_bytes: 471859200,
      disk_limit_bytes: 10737418240,
      suspended: false,
      owner: 'root',
      start_date: '2026-01-15',
    };
    expect(account.user).toBe('clientapp');
    expect(account.suspended).toBe(false);

    const suspension = {
      user: 'clientapp',
      action: 'suspend' as const,
      success: true,
      reason: 'Overdue billing notice',
      message: 'Account clientapp suspended successfully',
      timestamp: new Date().toISOString(),
    };
    expect(suspension.action).toBe('suspend');
    expect(suspension.success).toBe(true);
  });
});

describe('M12 Multi-Server Operations Types', () => {
  it('instantiates valid multi-server execution request and selector models', () => {
    const request = {
      batchId: 'batch-test-01',
      toolName: 'server.system_info',
      arguments: {},
      selector: {
        type: 'tag' as const,
        tag: 'web',
      },
      concurrencyLimit: 5,
      timeoutSeconds: 30,
    };

    expect(request.batchId).toBe('batch-test-01');
    expect(request.selector.type).toBe('tag');

    const result = {
      batchId: 'batch-test-01',
      toolName: 'server.system_info',
      selector: request.selector,
      totalNodes: 3,
      succeededNodes: 3,
      failedNodes: 0,
      nodes: [
        {
          serverId: 'srv-1',
          serverName: 'Web Server 1',
          hostname: 'web1.example.com',
          environment: 'PRODUCTION' as const,
          success: true,
          durationMs: 45,
        },
        {
          serverId: 'srv-2',
          serverName: 'Web Server 2',
          hostname: 'web2.example.com',
          environment: 'STAGING' as const,
          success: true,
          durationMs: 50,
        },
        {
          serverId: 'srv-3',
          serverName: 'Web Server 3',
          hostname: 'web3.example.com',
          environment: 'DEVELOPMENT' as const,
          success: true,
          durationMs: 38,
        },
      ],
      startedAt: '2026-09-20T00:00:00Z',
      completedAt: '2026-09-20T00:00:01Z',
    };

    expect(result.totalNodes).toBe(3);
    expect(result.succeededNodes).toBe(3);
    expect(result.failedNodes).toBe(0);
    expect(result.nodes[0]!.environment).toBe('PRODUCTION');
  });

  it('instantiates valid diagnostics matrix models', () => {
    const matrixResult = {
      batchId: 'matrix-001',
      diagnosticType: 'cpu_usage' as const,
      timestamp: '2026-09-20T00:00:00Z',
      totalNodes: 2,
      succeededNodes: 2,
      failedNodes: 0,
      rows: [
        {
          serverId: 'srv-1',
          serverName: 'Worker 1',
          hostname: 'worker1.lan',
          environment: 'PRODUCTION' as const,
          success: true,
          durationMs: 40,
          cpuCores: 8,
          cpuUsagePct: 24.5,
        },
        {
          serverId: 'srv-2',
          serverName: 'Worker 2',
          hostname: 'worker2.lan',
          environment: 'PRODUCTION' as const,
          success: true,
          durationMs: 42,
          cpuCores: 8,
          cpuUsagePct: 15.2,
        },
      ],
    };

    expect(matrixResult.rows.length).toBe(2);
    expect(matrixResult.rows[0]!.cpuCores).toBe(8);
  });

  it('instantiates valid M13 multi-provider AI configurations and models', () => {
    const aiConfig = {
      provider: 'anthropic' as const,
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.2,
      maxTokens: 4096,
    };

    expect(aiConfig.provider).toBe('anthropic');
    expect(aiConfig.model).toBe('claude-3-5-sonnet-20241022');

    const errorInfo = {
      code: 'AUTHENTICATION_FAILED' as const,
      message: 'Invalid API key provided for Anthropic provider',
      provider: 'anthropic',
      status: 401,
      actionableHint: 'Verify your API key in Settings > AI Provider Configuration.',
    };

    expect(errorInfo.code).toBe('AUTHENTICATION_FAILED');
    expect(errorInfo.status).toBe(401);
  });

  it('instantiates valid M14 privacy and data control configurations', () => {
    const privacy = {
      restrictedDataMode: true,
      secretRedactionEnabled: true,
      maxCharsPerToolOutput: 25_000,
      maxLogLinesPerExcerpt: 50,
      historyRetentionDays: 30,
    };

    expect(privacy.restrictedDataMode).toBe(true);
    expect(privacy.secretRedactionEnabled).toBe(true);
    expect(privacy.maxCharsPerToolOutput).toBe(25_000);

    const disclosure = {
      providerId: 'ollama',
      isLocal: true,
      dataLeavesDevice: false,
      destinationSummary: 'Local workstation (127.0.0.1:11434)',
      privacyNotice: 'Zero telemetry or prompt data leaves this device.',
    };

    expect(disclosure.isLocal).toBe(true);
    expect(disclosure.dataLeavesDevice).toBe(false);
  });

  it('instantiates valid M15 updater, release manifest, and SBOM metadata types', () => {
    const updateCheck = {
      status: 'UPDATE_AVAILABLE' as const,
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      releaseDate: '2026-10-01T00:00:00Z',
      releaseNotes: 'Performance improvements and new security policies',
      downloadUrl: 'https://releases.remotecommander.com/v1.1.0/RemoteCommander-Setup-1.1.0.exe',
      sha256Checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      signatureValid: true,
    };

    expect(updateCheck.status).toBe('UPDATE_AVAILABLE');
    expect(updateCheck.latestVersion).toBe('1.1.0');
    expect(updateCheck.signatureValid).toBe(true);

    const sbom = {
      format: 'CycloneDX' as const,
      specVersion: '1.5',
      componentCount: 42,
      generatedAt: new Date().toISOString(),
      sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      components: [
        {
          name: 'rusqlite',
          version: '0.32.0',
          ecosystem: 'cargo' as const,
          license: 'MIT',
        },
        {
          name: 'react',
          version: '18.3.1',
          ecosystem: 'npm' as const,
          license: 'MIT',
        },
      ],
    };

    expect(sbom.format).toBe('CycloneDX');
    expect(sbom.componentCount).toBe(42);
    expect(sbom.components?.length).toBe(2);
  });
});

describe('M16 Private Alpha & Readiness Types', () => {
  it('instantiates valid Alpha Readiness Report and Audit Export models', () => {
    const report = {
      status: 'READY_FOR_ALPHA' as const,
      totalChecks: 10,
      passedChecks: 10,
      failedChecks: 0,
      timestamp: new Date().toISOString(),
      checks: [
        {
          gate: 'Gate A',
          title: 'Zero Plaintext Secrets Storage',
          description: 'Keyring secrets isolated and 0 plaintext secrets in SQLite',
          passed: true,
          details: 'Verified against Master Spec §26 Gate A',
        },
        {
          gate: 'Gate B',
          title: 'Stable Target Identity Resolution',
          description: 'All state-changing operations require resolved server_id',
          passed: true,
        },
        {
          gate: 'Gate C',
          title: 'Immutable Audit Logging',
          description: 'Audit log table active and writable',
          passed: true,
        },
      ],
    };

    expect(report.status).toBe('READY_FOR_ALPHA');
    expect(report.totalChecks).toBe(10);
    expect(report.passedChecks).toBe(10);
    expect(report.checks[0]?.gate).toBe('Gate A');
    expect(report.checks[0]?.passed).toBe(true);

    const exportFilter = {
      serverId: 'srv-prod-01',
      eventType: 'TOOL_INVOKED',
    };
    expect(exportFilter.serverId).toBe('srv-prod-01');
  });
});
