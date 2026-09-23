import React from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  FolderTree,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react';

export type ActiveTab = 'dashboard' | 'chat' | 'files' | 'whm' | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  serverName: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab, serverName }) => {
  const navItems: Array<{ id: ActiveTab; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Host Overview', icon: <LayoutDashboard size={18} /> },
    { id: 'chat', label: 'AI Operations Chat', icon: <MessageSquare size={18} /> },
    { id: 'files', label: 'Website Files', icon: <FolderTree size={18} /> },
    { id: 'whm', label: 'cPanel & WHM', icon: <Server size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ];

  return (
    <div className="sidebar">
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={22} color="#58a6ff" />
          <div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#c9d1d9' }}>RemoteCommander</div>
            <div style={{ fontSize: '11px', color: '#8b949e' }}>Single-Server Web Agent</div>
          </div>
        </div>
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#58a6ff', background: '#1f242c', padding: '4px 8px', borderRadius: '4px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          Host: <strong>{serverName || 'localhost'}</strong>
        </div>
      </div>

      <div style={{ padding: '12px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                borderRadius: '6px',
                border: 'none',
                background: isActive ? '#1f242c' : 'transparent',
                color: isActive ? '#58a6ff' : '#8b949e',
                fontWeight: isActive ? 600 : 400,
                fontSize: '13px',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                transition: 'all 0.15s ease',
              }}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', fontSize: '11px', color: '#8b949e' }}>
        Version 1.0.0 Web Edition
      </div>
    </div>
  );
};
