import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface ServerChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thought?: string | undefined;
  tools?: Array<{ toolName: string; args: any; result: any }> | undefined;
  isStreaming?: boolean | undefined;
  attachments?: Array<{
    name: string;
    size: number;
    content?: string | undefined;
    type: 'image' | 'text';
    dataUrl?: string | undefined;
  }> | undefined;
  selectedChoice?: string | undefined;
}

export interface ServerChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ServerChatMessage[];
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

function getSessionsDir(): string {
  const dir = path.join(config.dataDir, 'sessions');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Ignore directory creation error
    }
  }
  return dir;
}

function getIndexFilePath(): string {
  return path.join(getSessionsDir(), 'index.json');
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

function getSessionFilePath(id: string): string {
  const safeId = sanitizeId(id);
  return path.join(getSessionsDir(), `${safeId}.json`);
}

/**
 * Rebuilds index.json by scanning all session files in data/sessions/
 */
function rebuildIndex(): ChatSessionSummary[] {
  const sessionsDir = getSessionsDir();
  const summaries: ChatSessionSummary[] = [];

  try {
    const files = fs.readdirSync(sessionsDir);
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'index.json') continue;
      const fullPath = path.join(sessionsDir, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const session = JSON.parse(raw) as ServerChatSession;
        if (session && session.id) {
          summaries.push({
            id: session.id,
            title: session.title || 'Untitled Session',
            createdAt: session.createdAt || Date.now(),
            updatedAt: session.updatedAt || session.createdAt || Date.now(),
            messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
          });
        }
      } catch {
        // Skip corrupted individual file
      }
    }

    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    fs.writeFileSync(getIndexFilePath(), JSON.stringify(summaries, null, 2), 'utf-8');
  } catch {
    // Ignore error
  }

  return summaries;
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  const indexFile = getIndexFilePath();
  if (!fs.existsSync(indexFile)) {
    return rebuildIndex();
  }

  try {
    const raw = fs.readFileSync(indexFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
    }
  } catch {
    // Corrupted index, rebuild from files
  }

  return rebuildIndex();
}

export async function getChatSession(id: string): Promise<ServerChatSession | null> {
  const filePath = getSessionFilePath(id);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const session = JSON.parse(raw) as ServerChatSession;
    return session;
  } catch {
    return null;
  }
}

export async function saveChatSession(session: ServerChatSession): Promise<ServerChatSession> {
  const safeId = sanitizeId(session.id || `session_${Date.now()}`);
  const fullSession: ServerChatSession = {
    id: safeId,
    title: session.title || 'New Session',
    createdAt: session.createdAt || Date.now(),
    updatedAt: Date.now(),
    messages: Array.isArray(session.messages) ? session.messages : [],
  };

  const filePath = getSessionFilePath(safeId);
  fs.writeFileSync(filePath, JSON.stringify(fullSession, null, 2), 'utf-8');

  // Update in-memory index file
  try {
    const summaries = await listChatSessions();
    const existingIdx = summaries.findIndex((s) => s.id === safeId);
    const summary: ChatSessionSummary = {
      id: safeId,
      title: fullSession.title,
      createdAt: fullSession.createdAt,
      updatedAt: fullSession.updatedAt,
      messageCount: fullSession.messages.length,
    };

    if (existingIdx >= 0) {
      summaries[existingIdx] = summary;
    } else {
      summaries.unshift(summary);
    }

    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    fs.writeFileSync(getIndexFilePath(), JSON.stringify(summaries, null, 2), 'utf-8');
  } catch {
    rebuildIndex();
  }

  return fullSession;
}

export async function deleteChatSession(id: string): Promise<boolean> {
  const safeId = sanitizeId(id);
  const filePath = getSessionFilePath(safeId);

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore
    }
  }

  try {
    const summaries = await listChatSessions();
    const filtered = summaries.filter((s) => s.id !== safeId);
    fs.writeFileSync(getIndexFilePath(), JSON.stringify(filtered, null, 2), 'utf-8');
  } catch {
    rebuildIndex();
  }

  return true;
}
