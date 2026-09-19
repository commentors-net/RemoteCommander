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
});
