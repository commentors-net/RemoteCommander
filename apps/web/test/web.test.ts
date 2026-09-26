import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getSystemMetrics } from '../src/server/system.js';
import { listDirectory, readFileContent, writeFileContent, deleteFileOrDirectory, extractArchive, resolveSafePath } from '../src/server/files.js';
import { config, updateConfig, encryptSecret, decryptSecret } from '../src/server/config.js';
import { generateSessionToken } from '../src/server/auth.js';
import { WEB_TOOLS } from '../src/server/chat.js';

describe('RemoteCommander Web Agent', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-web-test-'));
    updateConfig({ websiteRoot: tempDir, adminPassword: 'test-password-123' });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('collects local system metrics successfully', async () => {
    const metrics = await getSystemMetrics(tempDir);
    expect(metrics).toBeDefined();
    expect(metrics.hostname).toBeDefined();
    expect(metrics.cpuCores).toBeGreaterThan(0);
    expect(metrics.memory.totalBytes).toBeGreaterThan(0);
    expect(metrics.disk.totalGb).toBeGreaterThanOrEqual(0);
  });

  it('performs safe file operations within website root', async () => {
    // 1. Write file
    const writeRes = await writeFileContent('index.html', '<h1>Hello Web Agent</h1>');
    expect(writeRes.success).toBe(true);
    expect(writeRes.bytesWritten).toBeGreaterThan(0);

    // 2. Read file
    const readRes = await readFileContent('index.html');
    expect(readRes.content).toBe('<h1>Hello Web Agent</h1>');

    // 3. List directory
    const listRes = await listDirectory('');
    expect(listRes.files.some((f) => f.name === 'index.html')).toBe(true);

    // 4. Update file (creates backup)
    await writeFileContent('index.html', '<h1>Updated Content</h1>');
    const updatedRes = await readFileContent('index.html');
    expect(updatedRes.content).toBe('<h1>Updated Content</h1>');

    const updatedList = await listDirectory('');
    const backups = updatedList.files.filter((f) => f.name.includes('index.html.bak'));
    expect(backups.length).toBeGreaterThan(0);

    // 5. Delete file
    const delRes = await deleteFileOrDirectory('index.html');
    expect(delRes).toBe(true);
  });

  it('authenticates session with correct admin password', () => {
    const wrongToken = generateSessionToken('wrong-password');
    expect(wrongToken).toBeNull();

    const validToken = generateSessionToken('test-password-123');
    expect(validToken).toBeDefined();
    expect(typeof validToken).toBe('string');
    expect(validToken!.length).toBe(64);
  });

  it('registers comprehensive web tools with schemas', () => {
    expect(WEB_TOOLS.length).toBeGreaterThanOrEqual(10);
    const toolNames = WEB_TOOLS.map((t) => t.name);

    expect(toolNames).toContain('server.system_info');
    expect(toolNames).toContain('server.disk_usage');
    expect(toolNames).toContain('server.pm2_status');
    expect(toolNames).toContain('server.process_list');
    expect(toolNames).toContain('website.list_files');
    expect(toolNames).toContain('website.read_file');
    expect(toolNames).toContain('website.write_file');
    expect(toolNames).toContain('cpanel.whm_status');
    expect(toolNames).toContain('cpanel.list_accounts');
    expect(toolNames).toContain('cpanel.create_account');
  });

  it('executes tools seamlessly with both dot and underscore notations', async () => {
    const { executeWebTool } = await import('../src/server/chat.js');
    
    // Test both dot and underscore
    const dotRes = await executeWebTool('server.system_info', {});
    expect(dotRes).toBeDefined();
    expect(dotRes.hostname).toBeDefined();

    const underRes = await executeWebTool('server__system_info', {});
    expect(underRes).toBeDefined();
    expect(underRes.hostname).toBeDefined();

    // Test PM2 status tool (handles graceful fallback if PM2 is not in PATH)
    const pm2Res = await executeWebTool('server.pm2_status', {});
    expect(pm2Res).toBeDefined();
    expect(typeof pm2Res.pm2Available).toBe('boolean');
    expect(typeof pm2Res.message).toBe('string');

    // Test process list tool
    const procRes = await executeWebTool('server.process_list', { limit: 5 });
    expect(procRes).toBeDefined();
    expect(Array.isArray(procRes.processes)).toBe(true);
  });

  it('persists and manages chat sessions and logs on the server', async () => {
    const { listChatSessions, saveChatSession, getChatSession, deleteChatSession } = await import('../src/server/sessions.js');

    // 1. Create and save a new session with messages and tool results
    const session = await saveChatSession({
      id: 'test-session-1',
      title: 'Inspect PM2 & Process Health',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        { id: 'msg-1', role: 'user', content: 'What is the status of PM2?' },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'PM2 is checked.',
          thought: 'Executing server.pm2_status...',
          tools: [{ toolName: 'server.pm2_status', args: {}, result: { pm2Available: false } }],
        },
      ],
    });

    expect(session.id).toBe('test-session-1');
    expect(session.title).toBe('Inspect PM2 & Process Health');
    expect(session.messages.length).toBe(2);

    // 2. Retrieve session from server
    const fetched = await getChatSession('test-session-1');
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe('Inspect PM2 & Process Health');
    expect(fetched?.messages[1]?.tools?.[0]?.toolName).toBe('server.pm2_status');

    // 3. List sessions
    const list = await listChatSessions();
    expect(list.some((s) => s.id === 'test-session-1')).toBe(true);

    // 4. Delete session
    const deleted = await deleteChatSession('test-session-1');
    expect(deleted).toBe(true);

    const afterDelete = await getChatSession('test-session-1');
    expect(afterDelete).toBeNull();
  });

  it('encrypts and decrypts sensitive secrets using AES-256-GCM at rest', () => {
    const rawKey = 'sample-dummy-secret-key-1234567890';
    const encrypted = encryptSecret(rawKey);

    // Verify ciphertext format and that raw secret is not present in ciphertext
    expect(encrypted).toMatch(/^enc:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(encrypted).not.toContain(rawKey);

    // Decrypt and verify round-trip integrity
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(rawKey);

    // Idempotency: re-encrypting an already encrypted string should return unchanged
    expect(encryptSecret(encrypted)).toBe(encrypted);

    // Handles plaintext/empty gracefully
    expect(decryptSecret('')).toBe('');
    expect(decryptSecret('raw-unencrypted-legacy')).toBe('raw-unencrypted-legacy');
  });

  it('resolves safe paths across websiteRoot and user home directory', () => {
    const resolved = resolveSafePath('index.html');
    expect(resolved).toBe(path.join(tempDir, 'index.html'));

    // Strip redundant public_html prefix if websiteRoot ends with public_html
    const pubHtmlRoot = path.join(tempDir, 'public_html');
    updateConfig({ websiteRoot: pubHtmlRoot });
    const resolvedPub = resolveSafePath('public_html/style.css');
    expect(resolvedPub).toBe(path.join(pubHtmlRoot, 'style.css'));

    // Allow user home directory
    const userHome = os.homedir();
    const resolvedHome = resolveSafePath(userHome);
    expect(resolvedHome).toBe(path.resolve(userHome));

    // Deny path traversal outside allowed roots and provide Why and Resolution
    expect(() => resolveSafePath('../../../../../../../../../../etc/shadow')).toThrow();
    
    try {
      resolveSafePath('/etc/apache2/conf/httpd.conf');
      expect.unreachable();
    } catch (err: any) {
      expect(err.message).toContain('Access denied');
      expect(err.message).toContain('Why:');
      expect(err.message).toContain('.htaccess');
      expect(err.message).toContain('Resolution:');
    }
  });

  it('contains server.extract_zip in registered web tools', () => {
    const toolNames = WEB_TOOLS.map((t) => t.name);
    expect(toolNames).toContain('server.extract_zip');
  });
});


