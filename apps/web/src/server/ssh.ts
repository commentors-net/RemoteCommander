import { Client } from 'ssh2';
import crypto from 'node:crypto';
import { config } from './config.js';

export interface SshExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  command: string;
}

export interface SshConnectionStatus {
  success: boolean;
  message: string;
  user?: string;
  hostname?: string;
  uptime?: string;
  kernel?: string;
  error?: string;
}

/**
 * Generates an RSA-2048 SSH key pair formatted for OpenSSH and WHM.
 * The public key is output in single-line OpenSSH format (ssh-rsa AAAAB3... <comment>)
 * which can be directly imported into WHM > Security Center > Manage root's SSH Keys.
 */
export function generateSshKeyPair(comment = 'remote-commander-web'): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  const jwk = publicKey.export({ format: 'jwk' });
  const e = Buffer.from(jwk.e!, 'base64url');
  const n = Buffer.from(jwk.n!, 'base64url');

  function writeString(str: string): Buffer {
    const buf = Buffer.from(str);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(buf.length);
    return Buffer.concat([len, buf]);
  }

  function writeMpint(buf: Buffer): Buffer {
    const firstByte = buf.length > 0 ? (buf[0] as number) : 0;
    const prefix = firstByte & 0x80 ? Buffer.from([0x00]) : Buffer.alloc(0);
    const full = Buffer.concat([prefix, buf]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(full.length);
    return Buffer.concat([len, full]);
  }

  const openSsh = `ssh-rsa ${Buffer.concat([writeString('ssh-rsa'), writeMpint(e), writeMpint(n)]).toString('base64')} ${comment}`;

  return {
    publicKey: openSsh,
    privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  };
}

/**
 * Tests the root SSH connection to the hosting server (127.0.0.1 or configured host)
 * and retrieves basic system metadata (whoami, kernel version, uptime).
 */
export async function testSshConnection(override?: {
  host?: string;
  port?: number;
  username?: string;
  privateKey?: string;
  passphrase?: string;
}): Promise<SshConnectionStatus> {
  const host = override?.host || config.sshHost || '127.0.0.1';
  const port = override?.port || config.sshPort || 22;
  const username = override?.username || config.sshUsername || 'root';
  const privateKey = override?.privateKey !== undefined ? override.privateKey : config.sshPrivateKey;
  const passphrase = override?.passphrase !== undefined ? override.passphrase : config.sshPassphrase;

  if (!privateKey || !privateKey.trim()) {
    return {
      success: false,
      message: 'No SSH Private Key configured. Please enter or generate an SSH key in Settings.',
    };
  }

  return new Promise<SshConnectionStatus>((resolve) => {
    const client = new Client();
    let isResolved = false;

    const timeoutTimer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        try {
          client.end();
        } catch {
          // Ignore close error
        }
        resolve({
          success: false,
          message: `SSH connection timed out after 15 seconds connecting to ${host}:${port}. Check if SSH port is open and SSH service is running.`,
        });
      }
    }, 15000);

    client
      .on('ready', () => {
        client.exec('whoami && uname -sr && uptime', (err, stream) => {
          if (err) {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timeoutTimer);
              try { client.end(); } catch {}
              resolve({ success: false, message: `SSH command error: ${err.message}` });
            }
            return;
          }

          let stdout = '';
          stream
            .on('close', () => {
              if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutTimer);
                try { client.end(); } catch {}
                const lines = stdout.trim().split('\n');
                const user = lines[0]?.trim() || username;
                const kernel = lines[1]?.trim() || '';
                const uptime = lines.slice(2).join(' ').trim() || '';

                resolve({
                  success: true,
                  message: `SSH connection verified successfully! Logged in as ${user} on ${host}:${port}.`,
                  user,
                  kernel,
                  uptime,
                });
              }
            })
            .on('data', (data: Buffer) => {
              stdout += data.toString();
            })
            .stderr.on('data', () => {});
        });
      })
      .on('error', (err: any) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutTimer);
          let friendly = err.message || 'Connection failed';
          if (err.level === 'client-authentication') {
            friendly = `SSH authentication failed for user "${username}" on ${host}:${port}. Ensure the public key is authorized in WHM (Security Center > Manage root's SSH Keys > Manage Authorization).`;
          } else if (err.code === 'ECONNREFUSED') {
            friendly = `Connection refused at ${host}:${port}. Ensure SSH daemon (sshd) is running and port is correct.`;
          }
          resolve({ success: false, message: friendly, error: err.message });
        }
      });

    const connectConfig: import('ssh2').ConnectConfig = {
      host,
      port,
      username,
      privateKey: privateKey.trim(),
      readyTimeout: 12000,
      keepaliveInterval: 5000,
    };
    if (passphrase && passphrase.trim()) {
      connectConfig.passphrase = passphrase.trim();
    }
    client.connect(connectConfig);
  });
}

/**
 * Executes a shell command on the local hosting server via root SSH.
 */
export async function executeSshCommand(
  command: string,
  options?: { timeoutSeconds?: number; cwd?: string }
): Promise<SshExecutionResult> {
  const host = config.sshHost || '127.0.0.1';
  const port = config.sshPort || 22;
  const username = config.sshUsername || 'root';
  const privateKey = config.sshPrivateKey;
  const passphrase = config.sshPassphrase;
  const timeoutMs = (options?.timeoutSeconds || 60) * 1000;

  if (!privateKey || !privateKey.trim()) {
    throw new Error('SSH Private Key is not configured. Please configure root SSH access in Settings.');
  }

  const startTime = Date.now();
  let fullCmd = command.trim();
  if (options?.cwd && options.cwd.trim()) {
    fullCmd = `cd "${options.cwd.trim()}" && ${fullCmd}`;
  }

  return new Promise<SshExecutionResult>((resolve, reject) => {
    const client = new Client();
    let isDone = false;

    const timer = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        try { client.end(); } catch {}
        reject(new Error(`Command timed out after ${timeoutMs / 1000}s: ${command}`));
      }
    }, timeoutMs);

    client
      .on('ready', () => {
        client.exec(fullCmd, (err, stream) => {
          if (err) {
            if (!isDone) {
              isDone = true;
              clearTimeout(timer);
              try { client.end(); } catch {}
              reject(err);
            }
            return;
          }

          let stdout = '';
          let stderr = '';

          stream
            .on('close', (exitCode: number) => {
              if (!isDone) {
                isDone = true;
                clearTimeout(timer);
                try { client.end(); } catch {}
                const durationMs = Date.now() - startTime;
                resolve({
                  stdout,
                  stderr,
                  exitCode: exitCode ?? 0,
                  durationMs,
                  command: fullCmd,
                });
              }
            })
            .on('data', (chunk: Buffer) => {
              stdout += chunk.toString();
            })
            .stderr.on('data', (chunk: Buffer) => {
              stderr += chunk.toString();
            });
        });
      })
      .on('error', (err: any) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          reject(new Error(`SSH connection error: ${err.message}`));
        }
      });

    const connectConfig: import('ssh2').ConnectConfig = {
      host,
      port,
      username,
      privateKey: privateKey.trim(),
      readyTimeout: 12000,
      keepaliveInterval: 5000,
    };
    if (passphrase && passphrase.trim()) {
      connectConfig.passphrase = passphrase.trim();
    }
    client.connect(connectConfig);
  });
}
