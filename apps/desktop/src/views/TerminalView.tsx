import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ServerProfile } from '@remote-commander/shared-types';
import {
  Terminal as TermIcon,
  Plus,
  RefreshCw,
  Trash2,
  Columns,
  Square,
  X,
  Radio,
} from 'lucide-react';
import { Bridge, TerminalSessionInfo } from '../bridge.js';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  activeServer?: ServerProfile | undefined;
  splitMode?: boolean;
  onToggleSplit?: () => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  activeServer,
  splitMode = false,
  onToggleSplit,
}) => {
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [availableServers, setAvailableServers] = useState<ServerProfile[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string>('local');
  const [headlessInput, setHeadlessInput] = useState('');
  const [headlessOutput, setHeadlessOutput] = useState<string[]>([]);
  const [isXtermMounted, setIsXtermMounted] = useState(false);

  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastSeqRef = useRef<number>(0);
  const activeSessionIdRef = useRef<string | null>(null);

  activeSessionIdRef.current = activeSessionId;

  // Load available servers for session creation
  useEffect(() => {
    Bridge.listServers().then((servers) => {
      setAvailableServers(servers);
    });
  }, []);

  // Initialize or load sessions
  const loadSessions = useCallback(async () => {
    const list = await Bridge.listTerminalSessions();
    if (list.length === 0) {
      // Start initial session (for activeServer if selected, else Local)
      const init = await Bridge.startTerminalSession({
        serverId: activeServer?.id,
        title: activeServer ? `SSH: ${activeServer.name}` : 'Local Terminal',
      });
      setSessions([init]);
      setActiveSessionId(init.id);
    } else {
      setSessions(list);
      if (!activeSessionId || !list.some((s) => s.id === activeSessionId)) {
        const activeOne = list.find((s) => s.status === 'ACTIVE') ?? list[0];
        if (activeOne) {
          setActiveSessionId(activeOne.id);
        }
      }
    }
  }, [activeServer, activeSessionId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Mount xterm.js instance
  useEffect(() => {
    if (!terminalContainerRef.current) return;

    let term: XTerm | null = null;
    let fitAddon: FitAddon | null = null;

    try {
      term = new XTerm({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          selectionBackground: '#1f6feb44',
          black: '#0d1117',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
        },
        convertEol: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalContainerRef.current);
      fitAddon.fit();

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
      setIsXtermMounted(true);

      term.onData((data) => {
        const currId = activeSessionIdRef.current;
        if (currId) {
          Bridge.sendTerminalInput(currId, data).catch(() => {});
        }
      });

      term.onResize(({ cols, rows }) => {
        const currId = activeSessionIdRef.current;
        if (currId) {
          Bridge.resizeTerminal(currId, cols, rows).catch(() => {});
        }
      });
    } catch {
      // Fallback for jsdom / non-browser test environment
      setIsXtermMounted(false);
    }

    const handleWindowResize = () => {
      if (fitAddonRef.current && terminalContainerRef.current?.offsetParent !== null) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // ignore measurement errors
        }
      }
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (term) {
        try {
          term.dispose();
        } catch {
          // ignore cleanup errors
        }
      }
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Poll terminal output and synchronize with xterm and headless fallback
  useEffect(() => {
    if (!activeSessionId) return;

    lastSeqRef.current = 0;
    if (xtermRef.current) {
      xtermRef.current.reset();
    }
    setHeadlessOutput([]);

    let unmounted = false;

    const pollOutput = async () => {
      if (unmounted) return;
      try {
        const chunk = await Bridge.readTerminalOutput(activeSessionId, lastSeqRef.current);
        if (chunk.seq > lastSeqRef.current && chunk.data) {
          lastSeqRef.current = chunk.seq;
          if (xtermRef.current) {
            xtermRef.current.write(chunk.data);
          }
          setHeadlessOutput((prev) => [...prev, chunk.data]);
        }
      } catch {
        // ignore read errors
      }
    };

    pollOutput();
    const interval = setInterval(pollOutput, 150);

    return () => {
      unmounted = true;
      clearInterval(interval);
    };
  }, [activeSessionId]);

  // Session management handlers
  const handleCreateSession = async () => {
    const srv =
      selectedServerId !== 'local'
        ? availableServers.find((s) => s.id === selectedServerId)
        : undefined;

    const newSession = await Bridge.startTerminalSession({
      serverId: srv?.id,
      title: srv ? `SSH: ${srv.name}` : 'Local Terminal',
    });

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setShowNewModal(false);
  };

  const handleInterrupt = async () => {
    if (activeSessionId) {
      await Bridge.interruptTerminal(activeSessionId);
    }
  };

  const handleClear = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
    setHeadlessOutput([]);
  };

  const handleTerminateSession = async (sessionId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    await Bridge.terminateTerminalSession(sessionId);
    const updated = await Bridge.listTerminalSessions();
    setSessions(updated);
    if (activeSessionId === sessionId) {
      const next = updated.find((s) => s.status === 'ACTIVE') ?? updated[0];
      if (next) {
        setActiveSessionId(next.id);
      }
    }
  };

  const handleReconnect = async () => {
    if (!activeSession) return;
    const newSession = await Bridge.startTerminalSession({
      serverId: activeSession.server_id ?? undefined,
      title: activeSession.title,
    });
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };

  const handleHeadlessSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSessionId || !headlessInput) return;
    await Bridge.sendTerminalInput(activeSessionId, headlessInput + '\r');
    setHeadlessInput('');
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '520px',
        backgroundColor: '#0d1117',
        borderRadius: '8px',
        border: '1px solid #30363d',
        overflow: 'hidden',
      }}
    >
      {/* Tab Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: '#161b22',
          borderBottom: '1px solid #30363d',
          padding: '4px 8px',
          gap: '4px',
          overflowX: 'auto',
        }}
      >
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const isTerminated = session.status === 'TERMINATED';
          return (
            <div
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: isActive ? '#0d1117' : 'transparent',
                color: isActive ? '#58a6ff' : isTerminated ? '#8b949e' : '#c9d1d9',
                border: isActive ? '1px solid #30363d' : '1px solid transparent',
                fontSize: '13px',
                cursor: 'pointer',
                userSelect: 'none',
                maxWidth: '200px',
              }}
            >
              <Radio
                size={10}
                color={isTerminated ? '#8b949e' : isActive ? '#3fb950' : '#d29922'}
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {session.title}
              </span>
              <button
                onClick={(e) => handleTerminateSession(session.id, e)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8b949e',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Close session"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        <button
          onClick={() => setShowNewModal(true)}
          style={{
            background: 'none',
            border: '1px dashed #30363d',
            borderRadius: '6px',
            color: '#8b949e',
            cursor: 'pointer',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
          }}
          title="Open New Terminal Session"
        >
          <Plus size={14} /> New
        </button>
      </div>

      {/* Control Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          backgroundColor: '#161b22',
          borderBottom: '1px solid #21262d',
          fontSize: '13px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <TermIcon size={16} color="#58a6ff" />
          <span style={{ fontWeight: 600, color: '#f0f6fc' }}>
            {activeSession?.title ?? 'No Active Session'}
          </span>
          {activeSession?.server_name && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '10px',
                backgroundColor: '#1f6feb22',
                color: '#58a6ff',
                border: '1px solid #1f6feb44',
              }}
            >
              SSH Host
            </span>
          )}
          {activeSession?.status === 'TERMINATED' && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '10px',
                backgroundColor: '#da363322',
                color: '#f85149',
                border: '1px solid #da363344',
              }}
            >
              TERMINATED
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {onToggleSplit && (
            <button
              onClick={onToggleSplit}
              className="btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                padding: '4px 8px',
                backgroundColor: splitMode ? '#1f6feb33' : 'transparent',
                borderColor: splitMode ? '#388bfd' : '#30363d',
              }}
              title="Toggle Split View (Chat | Terminal)"
            >
              <Columns size={13} /> {splitMode ? 'Exit Split' : 'Split View'}
            </button>
          )}

          <button
            onClick={handleInterrupt}
            className="btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              padding: '4px 8px',
            }}
            title="Interrupt (Ctrl+C)"
          >
            <Square size={12} fill="#ff7b72" color="#ff7b72" /> Interrupt
          </button>

          <button
            onClick={handleClear}
            className="btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              padding: '4px 8px',
            }}
            title="Clear Output"
          >
            <Trash2 size={13} /> Clear
          </button>

          <button
            onClick={handleReconnect}
            className="btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              padding: '4px 8px',
            }}
            title="Reconnect / Restart Session"
          >
            <RefreshCw size={13} /> Restart
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        style={{
          flex: 1,
          padding: '8px',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          minHeight: '380px',
        }}
      >
        {/* xterm DOM Container */}
        <div
          ref={terminalContainerRef}
          style={{
            flex: 1,
            width: '100%',
            height: '100%',
            display: isXtermMounted ? 'block' : 'none',
          }}
        />

        {/* Headless / Test Fallback Console */}
        {!isXtermMounted && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#0d1117',
              fontFamily: 'Menlo, Monaco, monospace',
              fontSize: '13px',
              color: '#c9d1d9',
            }}
          >
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.5',
              }}
            >
              {headlessOutput.join('')}
            </div>
            <form
              onSubmit={handleHeadlessSend}
              style={{
                display: 'flex',
                borderTop: '1px solid #30363d',
                paddingTop: '6px',
                marginTop: '6px',
              }}
            >
              <span style={{ color: '#3fb950', marginRight: '6px' }}>&gt;</span>
              <input
                type="text"
                value={headlessInput}
                onChange={(e) => setHeadlessInput(e.target.value)}
                placeholder="Type command and press Enter..."
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            </form>
          </div>
        )}
      </div>

      {/* New Session Modal */}
      {showNewModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '8px',
              padding: '20px',
              width: '360px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '16px' }}>New Terminal Session</h3>
              <button
                onClick={() => setShowNewModal(false)}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  color: '#8b949e',
                  marginBottom: '6px',
                }}
              >
                Target Environment
              </label>
              <select
                value={selectedServerId}
                onChange={(e) => setSelectedServerId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  backgroundColor: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  color: '#fff',
                  outline: 'none',
                }}
              >
                <option value="local">Workstation (Local Shell)</option>
                {availableServers.map((srv) => (
                  <option key={srv.id} value={srv.id}>
                    SSH: {srv.name} ({srv.hostname})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setShowNewModal(false)} className="btn">
                Cancel
              </button>
              <button onClick={handleCreateSession} className="btn btn-primary">
                Launch Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
