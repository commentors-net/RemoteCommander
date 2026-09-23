import fs from 'node:fs';
import path from 'node:path';
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
};

const settingsFilePath = path.join(config.dataDir, 'settings.json');

export function loadPersistedSettings(): void {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const raw = fs.readFileSync(settingsFilePath, 'utf-8');
      const saved = JSON.parse(raw);
      if (saved.whmHost !== undefined) config.whmHost = saved.whmHost;
      if (saved.whmPort !== undefined) config.whmPort = Number.parseInt(String(saved.whmPort), 10);
      if (saved.whmToken !== undefined) config.whmToken = saved.whmToken;
      if (saved.openaiApiKey !== undefined) config.openaiApiKey = saved.openaiApiKey;
      if (saved.openaiModel !== undefined) config.openaiModel = saved.openaiModel;
      if (saved.websiteRoot !== undefined) config.websiteRoot = saved.websiteRoot;
      console.log('[Config] Loaded persistent settings from settings.json');
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
      WHM_API_TOKEN: config.whmToken,
      OPENAI_API_KEY: config.openaiApiKey,
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
    console.log(`[Config] Synced settings directly to ${activeEnvPath}`);
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
    if (!fs.existsSync(config.dataDir)) {
      fs.mkdirSync(config.dataDir, { recursive: true });
    }
    const toSave = {
      whmHost: config.whmHost,
      whmPort: config.whmPort,
      whmToken: config.whmToken,
      openaiApiKey: config.openaiApiKey,
      openaiModel: config.openaiModel,
      websiteRoot: config.websiteRoot,
    };
    fs.writeFileSync(settingsFilePath, JSON.stringify(toSave, null, 2), 'utf-8');
    console.log('[Config] Saved persistent settings to settings.json');
  } catch (err) {
    console.warn('[Config] Could not save settings to disk:', err);
  }

  syncToEnvFile();
  return config;
}

loadPersistedSettings();
