import React from 'react';
import { PermissionMode, ServerProfile } from '@remote-commander/shared-types';
import { Server, ShieldAlert } from 'lucide-react';

interface HeaderProps {
  servers: ServerProfile[];
  activeServerId?: string;
  onSelectServer: (id: string) => void;
  permissionMode: PermissionMode;
  onChangeMode: (mode: PermissionMode) => void;
}

export const Header: React.FC<HeaderProps> = ({
  servers,
  activeServerId,
  onSelectServer,
  permissionMode,
  onChangeMode,
}) => {
  const activeServer = servers.find((s) => s.id === activeServerId) || servers[0];

  return (
    <header className="top-bar">
      <div className="top-left">
        <div className="target-badge">
          <Server size={16} color="#58a6ff" />
          <span>Target:</span>
          <select
            value={activeServer?.id}
            onChange={(e) => onSelectServer(e.target.value)}
            style={{
              background: 'transparent',
              color: 'inherit',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {servers.map((s) => (
              <option key={s.id} value={s.id} style={{ background: '#161b22' }}>
                {s.name} ({s.environment})
              </option>
            ))}
          </select>
        </div>

        {activeServer?.environment === 'PRODUCTION' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#f85149',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            <ShieldAlert size={14} />
            <span>PRODUCTION TARGET</span>
          </div>
        )}
      </div>

      <div>
        <select
          className={`mode-badge ${permissionMode}`}
          value={permissionMode}
          onChange={(e) => onChangeMode(e.target.value as PermissionMode)}
          style={{ cursor: 'pointer' }}
        >
          <option value="SAFE_AUTOMATION">Safe Automation</option>
          <option value="APPROVAL_REQUIRED">Approval Required</option>
          <option value="FULL_ACCESS">Full Access</option>
        </select>
      </div>
    </header>
  );
};
