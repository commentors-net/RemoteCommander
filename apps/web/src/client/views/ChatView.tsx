import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  User,
  Wrench,
  ChevronDown,
  ChevronRight,
  Sparkles,
  AlertCircle,
  Paperclip,
  Image as ImageIcon,
  FileText,
  X,
  RotateCcw,
  History,
  Trash2,
  Plus,
  RefreshCw,
  ListChecks,
  CornerDownRight,
  Edit3,
  CheckCircle2,
} from 'lucide-react';
import { getAuthToken, resolveApiEndpoint, apiRequest } from '../api.js';
import { extractInteractiveChoices } from '../options.js';

export interface AttachedFile {
  name: string;
  size: number;
  content: string;
  type: 'image' | 'text';
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thought?: string;
  tools?: Array<{ toolName: string; args: any; result: any }>;
  isStreaming?: boolean;
  attachments?: AttachedFile[];
  selectedChoice?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const STORAGE_KEY = 'rc_web_chat_history_v1';
const SESSIONS_KEY = 'rc_web_chat_sessions_v2';
const ACTIVE_SESSION_ID_KEY = 'rc_web_active_session_id_v2';

const defaultWelcomeMsg: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Hello! I am your single-server AI operations assistant powered by `gpt-5-mini`. I can check system health, inspect website files in `public_html`, and manage cPanel/WHM accounts directly. You can also attach images (screenshots, errors) and code files for evaluation or deployment. How can I help you today?',
};

const createDefaultSession = (): ChatSession => ({
  id: `session_${Date.now()}`,
  title: 'New Session',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [defaultWelcomeMsg],
});

const loadInitialSessions = (): { sessions: ChatSession[]; activeId: string } => {
  try {
    const rawSessions = localStorage.getItem(SESSIONS_KEY);
    if (rawSessions) {
      const parsed = JSON.parse(rawSessions);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const savedActiveId = localStorage.getItem(ACTIVE_SESSION_ID_KEY) || parsed[0].id;
        const exists = parsed.some((s: any) => s.id === savedActiveId);
        return {
          sessions: parsed,
          activeId: exists ? savedActiveId : parsed[0].id,
        };
      }
    }

    // Check v1 migration
    const v1Saved = localStorage.getItem(STORAGE_KEY);
    if (v1Saved) {
      const parsedV1 = JSON.parse(v1Saved);
      if (Array.isArray(parsedV1) && parsedV1.length > 0) {
        const firstUser = parsedV1.find((m: any) => m.role === 'user');
        const rawContent = firstUser?.content ? String(firstUser.content).trim() : 'Previous Session';
        const title = rawContent.slice(0, 35) || 'Previous Session';
        const migrated: ChatSession = {
          id: `session_${Date.now()}`,
          title,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: parsedV1,
        };
        return { sessions: [migrated], activeId: migrated.id };
      }
    }
  } catch {
    // Ignore error
  }

  const def = createDefaultSession();
  return { sessions: [def], activeId: def.id };
};

export function parseToolError(errorStr: string | undefined, details?: any) {
  if (details && (details.reason || details.resolution)) {
    return {
      message: details.cleanPath ? `Access denied for: "${details.cleanPath}"` : 'Access denied',
      reason: details.reason || '',
      resolution: details.resolution || '',
    };
  }
  if (!errorStr) return { message: '', reason: '', resolution: '' };
  const str = String(errorStr);
  const whyMatch = str.match(/Why:\s*(.+?)(?=\nResolution:|$)/s);
  const resMatch = str.match(/Resolution:\s*(.+?)$/s);
  return {
    message: str.split('\nWhy:')[0].trim(),
    reason: whyMatch ? whyMatch[1].trim() : '',
    resolution: resMatch ? resMatch[1].trim() : '',
  };
}

export const ChatView: React.FC = () => {
  const [{ sessions, activeId }, setSessionState] = useState(loadInitialSessions);
  const [showSessionsDrawer, setShowSessionsDrawer] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [collapsedToolErrors, setCollapsedToolErrors] = useState<Record<string, boolean>>({});

  const activeSession = sessions.find((s) => s.id === activeId) || sessions[0] || createDefaultSession();
  const messages = activeSession.messages || [];

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  useEffect(() => {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
      localStorage.setItem(ACTIVE_SESSION_ID_KEY, activeId);
    } catch {
      // Storage quota or disabled
    }
  }, [sessions, activeId]);

  const syncSessionToServer = async (sessionToSync: ChatSession) => {
    try {
      await apiRequest('/api/chat/sessions', {
        method: 'POST',
        body: JSON.stringify(sessionToSync),
      });
    } catch {
      // Local fallback preserved if server temporarily unreachable
    }
  };

  const refreshSessionsFromServer = async () => {
    setIsLoadingSessions(true);
    try {
      const res = await apiRequest('/api/chat/sessions');
      const serverList = res.data;

      if (Array.isArray(serverList) && serverList.length > 0) {
        const targetId = activeId && serverList.some((s: any) => s.id === activeId) ? activeId : serverList[0].id;
        const detailRes = await apiRequest(`/api/chat/sessions/${targetId}`);
        if (detailRes.data) {
          setSessionState({
            sessions: serverList.map((s: any) => (s.id === targetId ? detailRes.data : { ...s, messages: [] })),
            activeId: targetId,
          });
        }
      } else {
        const initial = loadInitialSessions();
        if (initial.sessions.length > 0) {
          for (const s of initial.sessions) {
            await syncSessionToServer(s);
          }
        }
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoadingSessions(false);
    }
  };

  useEffect(() => {
    refreshSessionsFromServer();
  }, []);

  const setMessages = (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setSessionState((prev) => {
      const currentActive = prev.sessions.find((s) => s.id === prev.activeId) || prev.sessions[0];
      const newMessages = typeof updater === 'function' ? updater(currentActive ? currentActive.messages : []) : updater;

      let newTitle = currentActive?.title || 'New Session';
      if (newTitle === 'New Session') {
        const firstUser = newMessages.find((m) => m.role === 'user');
        if (firstUser && firstUser.content) {
          const rawText = typeof firstUser.content === 'string' ? firstUser.content : 'Chat Session';
          newTitle = rawText.trim().replace(/^[\r\n]+/, '').slice(0, 35) || 'New Session';
        }
      }

      const updatedSessions = prev.sessions.map((s) => {
        if (s.id === prev.activeId) {
          return {
            ...s,
            title: newTitle,
            updatedAt: Date.now(),
            messages: newMessages,
          };
        }
        return s;
      });

      return {
        sessions: updatedSessions,
        activeId: prev.activeId,
      };
    });
  };

  const handleNewChat = async () => {
    const newSession = createDefaultSession();
    setSessionState((prev) => ({
      sessions: [newSession, ...prev.sessions],
      activeId: newSession.id,
    }));
    setAttachments([]);
    setError(null);
    setShowSessionsDrawer(false);
    await syncSessionToServer(newSession);
  };

  const handleSelectSession = async (sessionId: string) => {
    setShowSessionsDrawer(false);
    setAttachments([]);
    setError(null);

    const existing = sessions.find((s) => s.id === sessionId);
    if (existing && existing.messages && existing.messages.length > 0) {
      setSessionState((prev) => ({ ...prev, activeId: sessionId }));
    } else {
      try {
        const res = await apiRequest(`/api/chat/sessions/${sessionId}`);
        if (res.data) {
          setSessionState((prev) => ({
            sessions: prev.sessions.map((s) => (s.id === sessionId ? res.data : s)),
            activeId: sessionId,
          }));
          return;
        }
      } catch {
        // Fallback
      }
      setSessionState((prev) => ({ ...prev, activeId: sessionId }));
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (window.confirm('Delete this chat session from the server?')) {
      try {
        await apiRequest(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
      } catch {
        // Ignore
      }

      setSessionState((prev) => {
        const filtered = prev.sessions.filter((s) => s.id !== sessionId);
        const nextSessions = filtered.length > 0 ? filtered : [createDefaultSession()];
        const nextActiveId = prev.activeId === sessionId ? nextSessions[0]!.id : prev.activeId;
        return {
          sessions: nextSessions,
          activeId: nextActiveId,
        };
      });
    }
  };

  const toggleThought = (msgId: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: AttachedFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImage = file.type.startsWith('image/');

      if (isImage) {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        newAttachments.push({
          name: file.name,
          size: file.size,
          content: dataUrl,
          type: 'image',
          dataUrl,
        });
      } else {
        const text = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsText(file);
        });
        newAttachments.push({
          name: file.name,
          size: file.size,
          content: text,
          type: 'text',
        });
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (
    e?: React.FormEvent,
    overridePrompt?: string,
    fromAssistantId?: string,
    selectedLabel?: string
  ) => {
    if (e) e.preventDefault();
    const prompt = (overridePrompt !== undefined ? overridePrompt : input).trim();
    if ((!prompt && attachments.length === 0) || isThinking) return;

    setError(null);
    if (overridePrompt === undefined) {
      setInput('');
    }

    const currentAttachments = [...attachments];
    setAttachments([]);

    // Build text message combining user text with any attached text files
    let combinedContent = prompt;
    const textFiles = currentAttachments.filter((a) => a.type === 'text');
    if (textFiles.length > 0) {
      const fileBlocks = textFiles
        .map((f) => `[Attached File: \`${f.name}\` (${(f.size / 1024).toFixed(1)} KB)]\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');
      combinedContent = prompt ? `${prompt}\n\n${fileBlocks}` : `Please evaluate the attached file(s):\n\n${fileBlocks}`;
    }

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `asst-${Date.now()}`;

    const baseMessages = fromAssistantId
      ? messages.map((m) =>
          m.id === fromAssistantId
            ? { ...m, selectedChoice: selectedLabel || prompt }
            : m
        )
      : messages;

    const newMessages: ChatMessage[] = [
      ...baseMessages,
      {
        id: userMsgId,
        role: 'user',
        content: combinedContent,
        attachments: currentAttachments,
      },
      { id: assistantMsgId, role: 'assistant', content: '', thought: '', tools: [], isStreaming: true },
    ];

    setMessages(newMessages);
    setIsThinking(true);
    setExpandedThoughts((prev) => ({ ...prev, [assistantMsgId]: true }));

    try {
      const token = getAuthToken();
      const response = await fetch(resolveApiEndpoint('/api/chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          messages: newMessages
            .filter((m) => m.id !== assistantMsgId)
            .map((m) => {
              if (m.attachments && m.attachments.some((a) => a.type === 'image')) {
                const parts: any[] = [{ type: 'text', text: m.content || 'Please evaluate the attached image(s).' }];
                for (const att of m.attachments) {
                  if (att.type === 'image') {
                    parts.push({
                      type: 'image_url',
                      image_url: { url: att.content },
                    });
                  }
                }
                return { role: m.role, content: parts };
              }
              return { role: m.role, content: m.content };
            }),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body is unavailable');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const eventMatch = block.match(/^event:\s*(\w+)/m);
          const dataMatch = block.match(/^data:\s*(.+)/m);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            let payload: any = {};
            try {
              payload = JSON.parse(dataMatch[1] || '{}');
            } catch {
              payload = {};
            }

            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMsgId) return msg;

                if (event === 'chunk' && payload.text) {
                  return { ...msg, content: msg.content + payload.text };
                }
                if (event === 'thought' && payload.text) {
                  return { ...msg, thought: (msg.thought || '') + '\n' + payload.text };
                }
                if (event === 'tool') {
                  const tools = [...(msg.tools || []), payload];
                  return { ...msg, tools };
                }
                if (event === 'done') {
                  return { ...msg, isStreaming: false };
                }
                if (event === 'error') {
                  setError(payload.error || 'Chat execution error');
                  return { ...msg, isStreaming: false };
                }
                return msg;
              }),
            );
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to stream AI response');
    } finally {
      setIsThinking(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m)),
      );
      setTimeout(() => {
        setSessionState((prev) => {
          const current = prev.sessions.find((s) => s.id === prev.activeId);
          if (current) {
            syncSessionToServer(current);
          }
          return prev;
        });
      }, 150);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Header bar */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={18} color="#bc8cff" />
          <span style={{ fontWeight: 600, fontSize: '14px' }}>AI Operations Assistant</span>
          <span className="badge badge-success">gpt-5-mini</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn"
            onClick={handleNewChat}
            style={{ fontSize: '11px', padding: '4px 9px', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Start a new chat session"
          >
            <RotateCcw size={12} />
            <span>New Chat</span>
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowSessionsDrawer((prev) => !prev)}
            style={{
              fontSize: '11px',
              padding: '4px 9px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              background: showSessionsDrawer ? '#21262d' : undefined,
              borderColor: showSessionsDrawer ? '#58a6ff' : undefined,
            }}
            title="View previous chat sessions"
          >
            <History size={13} color="#58a6ff" />
            <span>Sessions ({sessions.length})</span>
          </button>
        </div>
      </div>

      {/* Sessions Side Drawer */}
      {showSessionsDrawer && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '320px',
            backgroundColor: '#161b22',
            borderLeft: '1px solid #30363d',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 30,
            boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #30363d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px', color: '#c9d1d9' }}>
              <History size={15} color="#58a6ff" />
              <span>Chat Sessions ({sessions.length})</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                className="btn"
                style={{ padding: '2px 6px', fontSize: '11px' }}
                onClick={refreshSessionsFromServer}
                title="Refresh sessions from server"
              >
                <RefreshCw size={12} className={isLoadingSessions ? 'spin' : ''} />
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={handleNewChat}
                title="Create new session"
              >
                <Plus size={12} />
                <span>New</span>
              </button>
              <button
                type="button"
                className="btn"
                style={{ padding: '2px 6px', fontSize: '11px' }}
                onClick={() => setShowSessionsDrawer(false)}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {sessions.map((s) => {
              const isActive = s.id === activeId;
              const dateStr = new Date(s.updatedAt).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={s.id}
                  onClick={() => handleSelectSession(s.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    marginBottom: '8px',
                    backgroundColor: isActive ? '#1f242c' : '#0d1117',
                    border: isActive ? '1px solid #58a6ff' : '1px solid #30363d',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '12px',
                        color: isActive ? '#58a6ff' : '#c9d1d9',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                      title={s.title}
                    >
                      {s.title}
                    </div>
                    {sessions.length > 1 && (
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '2px 4px', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer' }}
                        title="Delete chat session"
                        onClick={(e) => handleDeleteSession(e, s.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{dateStr}</span>
                    <span>{s.messages.length} msgs</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: '8px 16px', background: 'rgba(218, 54, 51, 0.2)', borderBottom: '1px solid #da3633', color: '#f85149', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            const hasThought = Boolean(msg.thought?.trim());
            const isExpanded = expandedThoughts[msg.id] ?? false;

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                  justifyContent: isUser ? 'flex-end' : 'flex-start',
                }}
              >
                {!isUser && (
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: '#1f242c',
                      border: '1px solid #30363d',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Bot size={16} color="#58a6ff" />
                  </div>
                )}

                <div style={{ maxWidth: '80%' }}>
                  {/* Thought Preview Box */}
                  {!isUser && hasThought && (
                    <div
                      style={{
                        backgroundColor: '#161b22',
                        border: '1px solid #30363d',
                        borderRadius: '6px',
                        marginBottom: '8px',
                        overflow: 'hidden',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleThought(msg.id)}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: '#21262d',
                          border: 'none',
                          color: '#8b949e',
                          fontSize: '11px',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <Sparkles size={12} color="#bc8cff" />
                        <span>System Reasoning Trace</span>
                      </button>

                      {isExpanded && (
                        <div
                          style={{
                            padding: '10px 12px',
                            fontSize: '12px',
                            color: '#8b949e',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'monospace',
                            borderTop: '1px solid #30363d',
                            maxHeight: '180px',
                            overflowY: 'auto',
                          }}
                        >
                          {msg.thought}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tool Call Badges & Diagnostics */}
                  {!isUser && msg.tools && msg.tools.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '4px' }}>
                        {msg.tools.map((t, idx) => {
                          const hasError = Boolean(t.result?.error);
                          const toolKey = `${msg.id}-${idx}`;
                          const isCollapsed = collapsedToolErrors[toolKey] ?? false;

                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                if (hasError) {
                                  setCollapsedToolErrors((prev) => ({ ...prev, [toolKey]: !isCollapsed }));
                                }
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '11px',
                                background: hasError ? 'rgba(248, 81, 73, 0.15)' : '#1f242c',
                                border: `1px solid ${hasError ? '#f85149' : '#30363d'}`,
                                padding: '2px 8px',
                                borderRadius: '4px',
                                color: hasError ? '#f85149' : '#58a6ff',
                                cursor: hasError ? 'pointer' : 'default',
                              }}
                              title={hasError ? 'Click to toggle error diagnostic' : 'Tool executed successfully'}
                            >
                              {hasError ? <AlertCircle size={11} /> : <Wrench size={11} />}
                              <span>Tool: {t.toolName}</span>
                              {hasError && <span style={{ fontSize: '10px', opacity: 0.8 }}>(failed - click details)</span>}
                            </div>
                          );
                        })}
                      </div>

                      {/* Tool Error Diagnostics Breakdown (Why & Resolution) */}
                      {msg.tools.map((t, idx) => {
                        const hasError = Boolean(t.result?.error);
                        if (!hasError) return null;
                        const toolKey = `${msg.id}-${idx}`;
                        const isCollapsed = collapsedToolErrors[toolKey] ?? false;
                        if (isCollapsed) return null;

                        const parsed = parseToolError(t.result?.error, t.result?.details);

                        return (
                          <div
                            key={`err-${idx}`}
                            style={{
                              marginTop: '6px',
                              padding: '8px 12px',
                              background: 'rgba(218, 54, 51, 0.08)',
                              border: '1px solid rgba(218, 54, 51, 0.35)',
                              borderRadius: '6px',
                              fontSize: '11px',
                              lineHeight: '1.5',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <div style={{ fontWeight: 600, color: '#f85149', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <AlertCircle size={12} />
                                <span>Tool Execution Diagnostic: {t.toolName}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setCollapsedToolErrors((prev) => ({ ...prev, [toolKey]: true }))}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#8b949e',
                                  fontSize: '10px',
                                  cursor: 'pointer',
                                  padding: '0 4px',
                                }}
                              >
                                Hide
                              </button>
                            </div>

                            {parsed.reason && (
                              <div style={{ marginBottom: '4px', color: '#c9d1d9' }}>
                                <span style={{ color: '#f85149', fontWeight: 600 }}>Why Access Denied: </span>
                                <span>{parsed.reason}</span>
                              </div>
                            )}

                            {parsed.resolution && (
                              <div style={{ color: '#c9d1d9' }}>
                                <span style={{ color: '#3fb950', fontWeight: 600 }}>Suggested Resolution: </span>
                                <span>{parsed.resolution}</span>
                              </div>
                            )}

                            {!parsed.reason && !parsed.resolution && (
                              <div style={{ color: '#8b949e' }}>{t.result?.error}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Attachments rendering */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      {/* Images */}
                      {msg.attachments.filter((a) => a.type === 'image').length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
                          {msg.attachments
                            .filter((a) => a.type === 'image')
                            .map((att, aIdx) => (
                              <a
                                key={aIdx}
                                href={att.dataUrl || att.content}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Click to view full image"
                              >
                                <img
                                  src={att.dataUrl || att.content}
                                  alt={att.name}
                                  style={{
                                    maxWidth: '220px',
                                    maxHeight: '160px',
                                    borderRadius: '6px',
                                    border: '1px solid #30363d',
                                    objectFit: 'cover',
                                    display: 'block',
                                  }}
                                />
                              </a>
                            ))}
                        </div>
                      )}

                      {/* Text/code files */}
                      {msg.attachments.filter((a) => a.type === 'text').length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {msg.attachments
                            .filter((a) => a.type === 'text')
                            .map((att, aIdx) => (
                              <div
                                key={aIdx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  background: 'rgba(0,0,0,0.3)',
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  border: '1px solid #30363d',
                                  color: '#e6edf3',
                                }}
                              >
                                <FileText size={12} color="#58a6ff" />
                                <span>{att.name}</span>
                                <span style={{ opacity: 0.7 }}>({(att.size / 1024).toFixed(1)} KB)</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Message Bubble */}
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '8px',
                      backgroundColor: isUser ? '#1f6feb' : '#161b22',
                      border: isUser ? 'none' : '1px solid #30363d',
                      color: isUser ? '#ffffff' : '#c9d1d9',
                      fontSize: '13px',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.content || (msg.isStreaming ? 'Thinking...' : '(No text response generated)')}
                  </div>

                  {/* Interactive Choices / Quick Actions */}
                  {!isUser && !msg.isStreaming && (() => {
                    const choices = extractInteractiveChoices(msg.content);
                    if (choices.length === 0) return null;

                    // Check if an option was already selected or if this turn was already answered
                    const msgIndex = messages.findIndex((m) => m.id === msg.id);
                    const subsequentUserMsg =
                      msgIndex >= 0
                        ? messages.slice(msgIndex + 1).find((m) => m.role === 'user')
                        : undefined;

                    let selectedLabel = msg.selectedChoice;
                    if (!selectedLabel && subsequentUserMsg) {
                      const userContent = subsequentUserMsg.content.trim();
                      const matched = choices.find(
                        (c) =>
                          userContent === c.value.trim() ||
                          userContent.startsWith(c.value.trim()) ||
                          userContent === c.label.trim() ||
                          userContent.startsWith(c.label.trim()) ||
                          userContent.includes(c.label.trim())
                      );
                      if (matched) {
                        selectedLabel = matched.label;
                      }
                    }

                    // Case 1: Option already selected — show ONLY the chosen option as a locked, confirmed badge
                    // All other options and dropdown disappear completely so user cannot re-click them
                    if (selectedLabel) {
                      return (
                        <div
                          style={{
                            marginTop: '8px',
                            padding: '6px 12px',
                            background: 'rgba(22, 27, 34, 0.85)',
                            border: '1px solid #30363d',
                            borderRadius: '6px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '12px',
                            color: '#8b949e',
                          }}
                        >
                          <CheckCircle2 size={14} color="#3fb950" />
                          <span>
                            Selected: <strong style={{ color: '#e6edf3' }}>{selectedLabel}</strong>
                          </span>
                        </div>
                      );
                    }

                    // Case 2: Turn already answered by custom user message (not matching any choices)
                    // Hide outdated options to prevent clicking obsolete actions from past turns
                    if (subsequentUserMsg) {
                      return null;
                    }

                    // Case 3: Active current prompt waiting for user decision — render one-click buttons & dropdown
                    return (
                      <div
                        style={{
                          marginTop: '8px',
                          padding: '10px 12px',
                          background: 'rgba(22, 27, 34, 0.95)',
                          border: '1px solid #30363d',
                          borderRadius: '8px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#8b949e',
                            marginBottom: '8px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          <ListChecks size={13} color="#58a6ff" />
                          <span>Interactive Response (Click to send)</span>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {choices.map((choice) => (
                            <div
                              key={choice.id}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                borderRadius: '6px',
                                border:
                                  choice.variant === 'primary'
                                    ? '1px solid #238636'
                                    : choice.variant === 'danger'
                                    ? '1px solid #da3633'
                                    : '1px solid #388bfd',
                                backgroundColor:
                                  choice.variant === 'primary'
                                    ? 'rgba(35, 134, 54, 0.15)'
                                    : choice.variant === 'danger'
                                    ? 'rgba(218, 54, 51, 0.15)'
                                    : 'rgba(56, 139, 253, 0.12)',
                                overflow: 'hidden',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => handleSend(undefined, choice.value, msg.id, choice.label)}
                                disabled={isThinking}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  padding: '6px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  color:
                                    choice.variant === 'primary'
                                      ? '#3fb950'
                                      : choice.variant === 'danger'
                                      ? '#f85149'
                                      : '#58a6ff',
                                  fontSize: '12px',
                                  fontWeight: 500,
                                  cursor: isThinking ? 'not-allowed' : 'pointer',
                                  textAlign: 'left',
                                }}
                                title={`Click to reply "${choice.label}" immediately`}
                              >
                                <CornerDownRight size={13} />
                                <span>{choice.label}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInput(choice.value);
                                  textInputRef.current?.focus();
                                }}
                                style={{
                                  padding: '6px 8px',
                                  background: 'transparent',
                                  border: 'none',
                                  borderLeft: '1px solid rgba(255,255,255,0.1)',
                                  color: '#8b949e',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                }}
                                title="Insert into message box to edit"
                              >
                                <Edit3 size={11} />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Dropdown Selector for Multiple Choices / Paths */}
                        {choices.length >= 2 && (
                          <div
                            style={{
                              marginTop: '10px',
                              paddingTop: '8px',
                              borderTop: '1px solid #30363d',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span style={{ fontSize: '11px', color: '#8b949e' }}>Or select from dropdown:</span>
                            <select
                              id={`select-${msg.id}`}
                              defaultValue={choices[0].value}
                              style={{
                                backgroundColor: '#0d1117',
                                color: '#e6edf3',
                                border: '1px solid #30363d',
                                borderRadius: '4px',
                                padding: '4px 8px',
                                fontSize: '12px',
                                maxWidth: '340px',
                                cursor: 'pointer',
                              }}
                            >
                              {choices.map((c) => (
                                <option key={c.id} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                const sel = document.getElementById(`select-${msg.id}`) as HTMLSelectElement | null;
                                if (sel && sel.value) {
                                  const chosen = choices.find((c) => c.value === sel.value);
                                  handleSend(undefined, sel.value, msg.id, chosen?.label);
                                }
                              }}
                              disabled={isThinking}
                              className="btn btn-primary"
                              style={{ padding: '3px 10px', fontSize: '11px', height: '26px' }}
                            >
                              Apply & Send
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {isUser && (
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: '#238636',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <User size={16} color="#ffffff" />
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Form */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
        {/* Attachment preview bar */}
        {attachments.length > 0 && (
          <div style={{ maxWidth: '840px', margin: '0 auto 10px auto', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {attachments.map((att, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#21262d',
                  border: '1px solid #388bfd',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  color: '#c9d1d9',
                }}
              >
                {att.type === 'image' ? (
                  <img
                    src={att.dataUrl}
                    alt={att.name}
                    style={{ width: '22px', height: '22px', borderRadius: '3px', objectFit: 'cover' }}
                  />
                ) : (
                  <FileText size={14} color="#58a6ff" />
                )}
                <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.name}
                </span>
                <span style={{ fontSize: '10px', color: '#8b949e' }}>
                  ({(att.size / 1024).toFixed(1)} KB)
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#8b949e',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Remove attachment"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', gap: '8px' }}>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            multiple
            accept="image/*,.txt,.html,.php,.js,.ts,.json,.css,.env,.sql,.sh,.yml,.yaml,.md,.py,.conf,.ini"
            onChange={handleFileSelect}
          />
          <button
            type="button"
            className="btn"
            style={{ padding: '0 12px' }}
            onClick={() => fileInputRef.current?.click()}
            title="Attach image (screenshot) or code file"
            disabled={isThinking}
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={textInputRef}
            type="text"
            className="input-field"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything or attach file/image (e.g. 'Evaluate this error screenshot', 'Write this file to public_html/index.php')"
            disabled={isThinking}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isThinking || (!input.trim() && attachments.length === 0)}
            style={{ padding: '0 16px' }}
          >
            <Send size={15} />
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
