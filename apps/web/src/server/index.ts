import path from 'node:path';
import fs from 'node:fs';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { config, updateConfig } from './config.js';
import { generateSessionToken, revokeToken, requireAuth } from './auth.js';
import { getSystemMetrics } from './system.js';
import { listDirectory, readFileContent, writeFileContent, deleteFileOrDirectory } from './files.js';
import { testWhmConnection, listWhmAccounts, createWhmAccount, getWhmServiceStatus } from './whm.js';
import { runWebChat, testOpenAiConnection } from './chat.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Base URL / Path normalization (Handles subpath deployments like /commander on cPanel)
app.use((req: Request, _res: Response, next) => {
  if (req.url.startsWith('/commander/')) {
    req.url = req.url.slice('/commander'.length);
  } else if (req.url === '/commander') {
    req.url = '/';
  }
  next();
});

// 1. Auth routes
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { password } = req.body || {};
  const token = generateSessionToken(password || '');
  if (!token) {
    res.status(401).json({ success: false, error: 'Invalid password' });
    return;
  }
  res.json({ success: true, token });
});

app.get('/api/auth/check', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  res.json({ authenticated: !config.adminPassword || (!!token && generateSessionToken(config.adminPassword) !== null) });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token) revokeToken(token);
  res.json({ success: true });
});

// 2. System Status
app.get('/api/system/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const metrics = await getSystemMetrics(config.websiteRoot);
    res.json({ success: true, data: metrics });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. File Manager
app.get('/api/files/list', requireAuth, async (req: Request, res: Response) => {
  try {
    const subpath = (req.query.path as string) || '';
    const result = await listDirectory(subpath);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/files/read', requireAuth, async (req: Request, res: Response) => {
  try {
    const filePath = (req.query.path as string) || '';
    const result = await readFileContent(filePath);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/files/write', requireAuth, async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body || {};
    const result = await writeFileContent(filePath, content ?? '');
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/files/delete', requireAuth, async (req: Request, res: Response) => {
  try {
    const { path: filePath } = req.body || {};
    const result = await deleteFileOrDirectory(filePath);
    res.json({ success: true, deleted: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 4. WHM / cPanel API
app.get('/api/whm/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const status = await testWhmConnection();
    res.json({ success: true, data: status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/whm/accounts', requireAuth, async (_req: Request, res: Response) => {
  try {
    const accounts = await listWhmAccounts();
    res.json({ success: true, data: accounts });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/whm/create-account', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await createWhmAccount(req.body || {});
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/whm/services', requireAuth, async (_req: Request, res: Response) => {
  try {
    const services = await getWhmServiceStatus();
    res.json({ success: true, data: services });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. AI Chat (Server-Sent Events streaming)
app.post('/api/chat', requireAuth, async (req: Request, res: Response) => {
  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Messages array is required' });
    return;
  }

  // Setup SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runWebChat(
      messages,
      (chunk) => sendEvent('chunk', { text: chunk }),
      (thought) => sendEvent('thought', { text: thought }),
      (toolName, args, result) => sendEvent('tool', { toolName, args, result }),
    );
    sendEvent('done', { completed: true });
    res.end();
  } catch (err: any) {
    sendEvent('error', { error: err.message });
    res.end();
  }
});

// 6. Settings & AI Status
app.get('/api/ai/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await testOpenAiConnection();
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/settings', requireAuth, (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      port: config.port,
      whmHost: config.whmHost,
      whmPort: config.whmPort,
      hasWhmToken: Boolean(config.whmToken),
      hasOpenaiKey: Boolean(config.openaiApiKey),
      openaiModel: config.openaiModel,
      websiteRoot: config.websiteRoot,
    },
  });
});

app.post('/api/settings', requireAuth, (req: Request, res: Response) => {
  const { whmHost, whmPort, whmToken, openaiApiKey, openaiModel, websiteRoot } = req.body || {};
  const updates: Record<string, any> = {};
  if (whmHost !== undefined) updates.whmHost = String(whmHost).trim();
  if (whmPort !== undefined) updates.whmPort = Number.parseInt(String(whmPort), 10) || 2087;
  if (whmToken !== undefined) updates.whmToken = whmToken;
  if (openaiApiKey !== undefined) updates.openaiApiKey = openaiApiKey;
  if (openaiModel !== undefined) updates.openaiModel = openaiModel;
  if (websiteRoot !== undefined) updates.websiteRoot = websiteRoot;

  updateConfig(updates);
  res.json({ success: true, message: 'Settings saved successfully' });
});

// 7. Static files & SPA Fallback
const possibleStaticDirs = [
  path.resolve(process.cwd(), 'dist/public'),
  path.resolve(process.cwd(), 'public'),
  path.resolve(__dirname, '../public'),
  path.resolve(__dirname, 'public'),
  path.resolve(__dirname, '../../dist/public'),
];

let activeStaticDir = '';
for (const dir of possibleStaticDirs) {
  if (fs.existsSync(dir)) {
    activeStaticDir = dir;
    break;
  }
}

if (activeStaticDir) {
  app.use(express.static(activeStaticDir));
  app.use('/commander', express.static(activeStaticDir));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(activeStaticDir, 'index.html'));
  });
}

// 8. Server Listen (Supports Phusion Passenger socket & Standalone TCP port)
const isPassenger =
  typeof (globalThis as any).PhusionPassenger !== 'undefined' ||
  Boolean(process.env.PASSENGER_APP_ENV) ||
  Boolean(process.env.PASSENGER_APP_ENTRY_POINT);

const rawPort = process.env.PORT || config.port || 3000;

if (isPassenger || (typeof rawPort === 'string' && (rawPort.startsWith('/') || rawPort.toLowerCase() === 'passenger'))) {
  app.listen('passenger', () => {
    console.log('[RemoteCommander Web] Server running via Phusion Passenger socket');
    console.log(`[RemoteCommander Web] Website Root: ${config.websiteRoot}`);
    console.log(`[RemoteCommander Web] Static Dir: ${activeStaticDir}`);
  });
} else {
  const portNum = Number.parseInt(String(rawPort), 10) || 3000;
  app.listen(portNum, '0.0.0.0', () => {
    console.log(`[RemoteCommander Web] Server running on http://0.0.0.0:${portNum}`);
    console.log(`[RemoteCommander Web] Website Root: ${config.websiteRoot}`);
    console.log(`[RemoteCommander Web] Static Dir: ${activeStaticDir}`);
  });
}

export default app;
