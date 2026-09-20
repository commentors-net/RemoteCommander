import { describe, it, expect } from 'vitest';
import { createDefaultToolRegistry, scanCommandHeuristics } from '../index.js';

describe('Tool Registry', () => {
  it('registers and retrieves default baseline tools', () => {
    const registry = createDefaultToolRegistry();
    expect(registry.has('local.system_info')).toBe(true);
    expect(registry.has('local.list_directory')).toBe(true);
    expect(registry.has('local.read_file')).toBe(true);
    expect(registry.has('local.process_list')).toBe(true);
    expect(registry.has('ssh.execute')).toBe(true);
    expect(registry.has('server.disk_usage')).toBe(true);
    expect(registry.has('cpanel.list_accounts')).toBe(true);
    expect(registry.has('non.existent.tool')).toBe(false);

    const sshTool = registry.get('ssh.execute');
    expect(sshTool?.risk).toBe('MEDIUM');
    expect(sshTool?.category).toBe('ssh');

    const procTool = registry.get('local.process_list');
    expect(procTool?.risk).toBe('READ_ONLY');
    expect(procTool?.category).toBe('local');

    // M10 Semantic Server Operations tools
    const m10Tools = [
      'server.system_info',
      'server.disk_usage',
      'server.memory_usage',
      'server.cpu_usage',
      'server.load_average',
      'server.process_list',
      'server.network_connections',
      'server.service_status',
      'server.service_start',
      'server.service_stop',
      'server.service_restart',
      'server.tail_log',
    ];
    for (const toolName of m10Tools) {
      expect(registry.has(toolName)).toBe(true);
      expect(registry.get(toolName)?.category).toBe('server');
    }
    // M11 WHM/cPanel tools
    const m11Tools = [
      'cpanel.server_info',
      'cpanel.list_accounts',
      'cpanel.account_info',
      'cpanel.list_domains',
      'cpanel.service_status',
      'cpanel.restart_service',
      'cpanel.ssl_status',
      'cpanel.backup_status',
      'cpanel.account_disk_usage',
      'cpanel.list_php_versions',
      'cpanel.suspend_account',
      'cpanel.unsuspend_account',
    ];
    for (const toolName of m11Tools) {
      expect(registry.has(toolName)).toBe(true);
      expect(registry.get(toolName)?.category).toBe('cpanel');
    }
    expect(registry.get('cpanel.suspend_account')?.risk).toBe('HIGH');
    expect(registry.get('cpanel.restart_service')?.risk).toBe('MEDIUM');
    expect(registry.get('cpanel.unsuspend_account')?.risk).toBe('MEDIUM');
    expect(registry.get('cpanel.list_accounts')?.risk).toBe('READ_ONLY');
  });
});

describe('Heuristic Command Scanner (Defense-in-Depth)', () => {
  it('detects rm -rf / and flags as CRITICAL', () => {
    const res = scanCommandHeuristics('rm -rf /');
    expect(res.flagged).toBe(true);
    expect(res.suggestedRiskLevel).toBe('CRITICAL');
    expect(res.patternsMatched).toContain('ROOT_OR_HOME_RECURSIVE_DELETION');
  });

  it('detects filesystem formatting mkfs.ext4 and flags as CRITICAL', () => {
    const res = scanCommandHeuristics('mkfs.ext4 /dev/sda1');
    expect(res.flagged).toBe(true);
    expect(res.suggestedRiskLevel).toBe('CRITICAL');
    expect(res.patternsMatched).toContain('FILESYSTEM_OR_PARTITION_FORMAT');
  });

  it('detects raw block device write via dd', () => {
    const res = scanCommandHeuristics('dd if=/dev/zero of=/dev/sda bs=1M count=100');
    expect(res.flagged).toBe(true);
    expect(res.suggestedRiskLevel).toBe('CRITICAL');
    expect(res.patternsMatched).toContain('RAW_BLOCK_DEVICE_WRITE');
  });

  it('detects DROP DATABASE SQL statement', () => {
    const res = scanCommandHeuristics('mysql -e "DROP DATABASE customer_prod"');
    expect(res.flagged).toBe(true);
    expect(res.suggestedRiskLevel).toBe('CRITICAL');
    expect(res.patternsMatched).toContain('DATABASE_DROP');
  });

  it('does not flag benign commands like uptime or systemctl status', () => {
    const res1 = scanCommandHeuristics('uptime');
    expect(res1.flagged).toBe(false);

    const res2 = scanCommandHeuristics('systemctl status mariadb');
    expect(res2.flagged).toBe(false);
  });

  it('registers and retrieves M12 multi-server tools with appropriate risk levels', () => {
    const registry = createDefaultToolRegistry();

    expect(registry.has('multi_server.execute_batch')).toBe(true);
    const batchTool = registry.get('multi_server.execute_batch');
    expect(batchTool?.category).toBe('multi_server');
    expect(batchTool?.risk).toBe('HIGH');
    expect(batchTool?.inputSchema.required).toContain('tool_name');
    expect(batchTool?.inputSchema.required).toContain('selector');

    expect(registry.has('multi_server.diagnostics_matrix')).toBe(true);
    const matrixTool = registry.get('multi_server.diagnostics_matrix');
    expect(matrixTool?.category).toBe('multi_server');
    expect(matrixTool?.risk).toBe('READ_ONLY');
    expect(matrixTool?.inputSchema.required).toContain('selector');
    expect(matrixTool?.inputSchema.required).toContain('diagnostic_type');
  });
});
