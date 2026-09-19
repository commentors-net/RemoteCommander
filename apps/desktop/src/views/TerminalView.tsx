import React, { useState } from 'react';
import { ServerProfile } from '@remote-commander/shared-types';
import { Terminal as TermIcon, Play, RefreshCw } from 'lucide-react';

interface TerminalViewProps {
  activeServer?: ServerProfile | undefined;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ activeServer }) => {
  const [sessionOutput] = useState<string[]>([
    `[RemoteCommander Native PTY Host v0.1.0]`,
    `Direct SSH session established: ${activeServer?.username ?? 'root'}@${activeServer?.hostname ?? 'localhost'}`,
    `Linux 6.1.0-28-amd64 #1 SMP PREEMPT_DYNAMIC Debian`,
    ``,
    `${activeServer?.username ?? 'root'}@${activeServer?.name ?? 'server'}:~# `,
  ]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <TermIcon size={20} color="#58a6ff" />
          <h2 style={{ fontSize: '18px' }}>
            Interactive Terminal — {activeServer?.name ?? 'Local Terminal'}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <RefreshCw size={14} /> Reconnect
          </button>
          <button
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Play size={14} /> New Session
          </button>
        </div>
      </div>

      <div className="terminal-window">
        {sessionOutput.map((line, idx) => (
          <div key={idx} style={{ lineHeight: '1.6' }}>
            {line}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: '4px' }}>
          <span style={{ color: '#3fb950', marginRight: '6px' }}>&gt;</span>
          <input
            type="text"
            placeholder="Type shell command..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
};
