import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

let activeEnvPath = path.resolve(process.cwd(), '.env');

const candidateEnvFiles = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '.env'),
];

for (const envFile of candidateEnvFiles) {
  if (fs.existsSync(envFile)) {
    activeEnvPath = envFile;
    dotenv.config({ path: envFile });
    console.log(`[Config] Loaded environment variables from: ${envFile}`);
    break;
  }
}
dotenv.config();

export interface WebConfig {
  port: number;
  adminPassword: string;
  jwtSecret: string;
  whmHost: string;
  whmPort: number;
  whmToken: string;
  openaiApiKey: string;
  openaiModel: string;
  websiteRoot: string;
  dataDir: string;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshPrivateKey: string;
  sshPassphrase: string;
}

const defaultDataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(defaultDataDir)) {
  try {
    fs.mkdirSync(defaultDataDir, { recursive: true });
  } catch {
    // Ignore error
  }
}

export const config: WebConfig = {
  port: Number.parseInt(process.env.PORT || '3000', 10),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  jwtSecret: process.env.JWT_SECRET || 'rc-web-secret-key-change-in-production',
  whmHost: process.env.WHM_HOST || '127.0.0.1',
  whmPort: Number.parseInt(process.env.WHM_PORT || '2087', 10),
  whmToken: process.env.WHM_API_TOKEN || process.env.WHM_TOKEN || '',
  openaiApiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5-mini',
  websiteRoot: process.env.WEBSITE_ROOT || path.resolve(process.cwd(), 'public_html'),
  dataDir: process.env.DATA_DIR || defaultDataDir,
  sshEnabled: process.env.SSH_ENABLED === 'true' || false,
  sshHost: process.env.SSH_HOST || '127.0.0.1',
  sshPort: Number.parseInt(process.env.SSH_PORT || '22', 10),
  sshUsername: process.env.SSH_USERNAME || 'root',
  sshPrivateKey: process.env.SSH_PRIVATE_KEY || '',
  sshPassphrase: process.env.SSH_PASSPHRASE || '',
};

const settingsFilePath = path.join(config.dataDir, 'settings.json');

const CIPHER_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const SECRET_PREFIX = 'enc:v1:';

function getMasterKey(): Buffer {
  if (process.env.APP_ENCRYPTION_KEY && process.env.APP_ENCRYPTION_KEY.trim()) {
    return crypto.createHash('sha256').update(process.env.APP_ENCRYPTION_KEY.trim()).digest();
  }

  const keyFilePath = path.join(config.dataDir, '.secret_key');
  try {
    if (fs.existsSync(keyFilePath)) {
      const existing = fs.readFileSync(keyFilePath, 'utf-8').trim();
      if (existing.length >= 32) {
        return crypto.createHash('sha256').update(existing).digest();
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFilePath, generated, { mode: 0o600, encoding: 'utf-8' });
    return crypto.createHash('sha256').update(generated).digest();
  } catch {
    return crypto.createHash('sha256').update(config.jwtSecret || 'rc-secret-encryption-master-salt').digest();
  }
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext || plaintext.startsWith(SECRET_PREFIX)) {
    return plaintext;
  }
  try {
    const key = getMasterKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${SECRET_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (err) {
    console.warn('[Config] Failed to encrypt secret:', err);
    return plaintext;
  }
}

export function decryptSecret(value: string): string {
  if (!value || !value.startsWith(SECRET_PREFIX)) {
    return value;
  }
  try {
    const parts = value.slice(SECRET_PREFIX.length).split(':');
    if (parts.length !== 3) return value;
    const [ivHex, tagHex, cipherHex] = parts;
    if (!ivHex || !tagHex || !cipherHex) return value;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');
    const key = getMasterKey();
    const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  } catch (err) {
    console.warn('[Config] Failed to decrypt secret:', err);
    return value;
  }
}

function saveSettingsToDisk(): void {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
  const toSave = {
    whmHost: config.whmHost,
    whmPort: config.whmPort,
    whmToken: encryptSecret(config.whmToken),
    openaiApiKey: encryptSecret(config.openaiApiKey),
    openaiModel: config.openaiModel,
    websiteRoot: config.websiteRoot,
    sshEnabled: config.sshEnabled,
    sshHost: config.sshHost,
    sshPort: config.sshPort,
    sshUsername: config.sshUsername,
    sshPrivateKey: encryptSecret(config.sshPrivateKey),
    sshPassphrase: encryptSecret(config.sshPassphrase),
  };
  fs.writeFileSync(settingsFilePath, JSON.stringify(toSave, null, 2), { mode: 0o600, encoding: 'utf-8' });
  console.log('[Config] Saved persistent settings to settings.json (AES-256 encrypted)');
}

export function loadPersistedSettings(): void {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const raw = fs.readFileSync(settingsFilePath, 'utf-8');
      const saved = JSON.parse(raw);
      let needsMigration = false;

      if (saved.whmHost !== undefined) config.whmHost = saved.whmHost;
      if (saved.whmPort !== undefined) config.whmPort = Number.parseInt(String(saved.whmPort), 10);
      if (saved.whmToken !== undefined) {
        if (typeof saved.whmToken === 'string' && !saved.whmToken.startsWith(SECRET_PREFIX) && saved.whmToken.trim()) {
          needsMigration = true;
        }
        config.whmToken = decryptSecret(saved.whmToken);
      }
      if (saved.openaiApiKey !== undefined) {
        if (typeof saved.openaiApiKey === 'string' && !saved.openaiApiKey.startsWith(SECRET_PREFIX) && saved.openaiApiKey.trim()) {
          needsMigration = true;
        }
        config.openaiApiKey = decryptSecret(saved.openaiApiKey);
      }
      if (saved.openaiModel !== undefined) config.openaiModel = saved.openaiModel;
      if (saved.websiteRoot !== undefined) config.websiteRoot = saved.websiteRoot;
      if (saved.sshEnabled !== undefined) config.sshEnabled = Boolean(saved.sshEnabled);
      if (saved.sshHost !== undefined) config.sshHost = saved.sshHost;
      if (saved.sshPort !== undefined) config.sshPort = Number.parseInt(String(saved.sshPort), 10);
      if (saved.sshUsername !== undefined) config.sshUsername = saved.sshUsername;
      if (saved.sshPrivateKey !== undefined) {
        if (typeof saved.sshPrivateKey === 'string' && !saved.sshPrivateKey.startsWith(SECRET_PREFIX) && saved.sshPrivateKey.trim()) {
          needsMigration = true;
        }
        config.sshPrivateKey = decryptSecret(saved.sshPrivateKey);
      }
      if (saved.sshPassphrase !== undefined) {
        if (typeof saved.sshPassphrase === 'string' && !saved.sshPassphrase.startsWith(SECRET_PREFIX) && saved.sshPassphrase.trim()) {
          needsMigration = true;
        }
        config.sshPassphrase = decryptSecret(saved.sshPassphrase);
      }
      console.log('[Config] Loaded persistent settings from settings.json (AES-256 encrypted)');

      // If legacy plaintext was detected in settings.json, rewrite immediately with encryption
      if (needsMigration && !process.env.VITEST && process.env.NODE_ENV !== 'test') {
        saveSettingsToDisk();
        console.log('[Config] Successfully migrated legacy plaintext secrets to AES-256 encrypted at rest');
      }
    }
  } catch (err) {
    console.warn('[Config] Could not load persisted settings:', err);
  }
}

function syncToEnvFile(): void {
  try {
    let existingLines: string[] = [];
    if (fs.existsSync(activeEnvPath)) {
      existingLines = fs.readFileSync(activeEnvPath, 'utf-8').split(/\r?\n/);
    }

    const envMap: Record<string, string> = {
      PORT: String(config.port),
      ADMIN_PASSWORD: config.adminPassword,
      JWT_SECRET: config.jwtSecret,
      WHM_HOST: config.whmHost,
      WHM_PORT: String(config.whmPort),
      OPENAI_MODEL: config.openaiModel,
      WEBSITE_ROOT: config.websiteRoot,
    };

    const updatedKeys = new Set<string>();
    const newLines = existingLines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const match = trimmed.match(/^([A-Za-z0-9_]+)=(.*)$/);
      const key = match?.[1];
      if (key && envMap[key] !== undefined) {
        updatedKeys.add(key);
        return `${key}=${envMap[key]}`;
      }
      return line;
    });

    for (const [k, v] of Object.entries(envMap)) {
      if (!updatedKeys.has(k)) {
        newLines.push(`${k}=${v}`);
      }
    }

    fs.writeFileSync(activeEnvPath, newLines.join('\n'), 'utf-8');
    console.log(`[Config] Synced non-sensitive settings to ${activeEnvPath}`);
  } catch (err) {
    console.warn('[Config] Could not sync to .env file:', err);
  }
}

export function updateConfig(updates: Partial<WebConfig>): WebConfig {
  Object.assign(config, updates);
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return config;
  }
  try {
    saveSettingsToDisk();
  } catch (err) {
    console.warn('[Config] Could not save settings to disk:', err);
  }

  syncToEnvFile();
  return config;
}

loadPersistedSettings();

