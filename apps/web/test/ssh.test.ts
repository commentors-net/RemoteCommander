import { describe, it, expect } from 'vitest';
import { generateSshKeyPair, testSshConnection } from '../src/server/ssh.js';
import { config, updateConfig, encryptSecret, decryptSecret } from '../src/server/config.js';
import { WEB_TOOLS } from '../src/server/chat.js';

describe('Local Server SSH Access', () => {
  it('generates a valid OpenSSH RSA-2048 key pair for WHM import', () => {
    const keyPair = generateSshKeyPair('test-remote-commander');
    expect(keyPair).toBeDefined();
    expect(keyPair.publicKey).toMatch(/^ssh-rsa AAAA[A-Za-z0-9+/=]+ test-remote-commander$/);
    expect(keyPair.privateKey).toContain('-----BEGIN RSA PRIVATE KEY-----');
    expect(keyPair.privateKey).toContain('-----END RSA PRIVATE KEY-----');
  });

  it('reports friendly error when testing SSH without private key', async () => {
    const res = await testSshConnection({ privateKey: '' });
    expect(res.success).toBe(false);
    expect(res.message).toContain('No SSH Private Key configured');
  });

  it('encrypts and decrypts SSH private key using AES-256-GCM', () => {
    const sampleKey = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    const encrypted = encryptSecret(sampleKey);
    expect(encrypted).toMatch(/^enc:v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(encrypted).not.toContain('BEGIN RSA PRIVATE KEY');

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(sampleKey);
  });

  it('registers server.ssh_execute and server.ssh_status tools in WEB_TOOLS', () => {
    const names = WEB_TOOLS.map((t) => t.name);
    expect(names).toContain('server.ssh_execute');
    expect(names).toContain('server.ssh_status');

    const sshExecute = WEB_TOOLS.find((t) => t.name === 'server.ssh_execute');
    expect(sshExecute?.inputSchema.properties?.command).toBeDefined();
    expect(sshExecute?.risk).toBe('MEDIUM');
  });

  it('updates and persists SSH configuration settings', () => {
    updateConfig({
      sshHost: '127.0.0.1',
      sshPort: 22022,
      sshUsername: 'root',
      sshEnabled: true,
    });

    expect(config.sshHost).toBe('127.0.0.1');
    expect(config.sshPort).toBe(22022);
    expect(config.sshUsername).toBe('root');
    expect(config.sshEnabled).toBe(true);
  });
});
