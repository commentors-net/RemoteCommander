import React from 'react';
import { ViewMode, SUPPORTED_VIEWS } from '../index.js';
import {
  MessageSquare,
  Server,
  Terminal,
  FolderTree,
  Activity,
  Settings,
  ShieldCheck,
} from 'lucide-react';

interface NavigationProps {
  activeView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  appVersion: string;
}

const VIEW_ICONS: Record<ViewMode, React.ReactNode> = {
  Chat: <MessageSquare size={18} />,
  Servers: <Server size={18} />,
  Terminal: <Terminal size={18} />,
  Files: <FolderTree size={18} />,
  Activity: <Activity size={18} />,
  Settings: <Settings size={18} />,
};

export const Navigation: React.FC<NavigationProps> = ({ activeView, onSelectView, appVersion }) => {
  return (
    <aside className="sidebar">
      <div className="brand-header">
        <ShieldCheck size={24} color="#58a6ff" />
        <span className="brand-title">RemoteCommander</span>
        <span className="brand-badge">v{appVersion}</span>
      </div>

      <ul className="nav-list">
        {SUPPORTED_VIEWS.map((view) => (
          <li
            key={view}
            className={`nav-item ${activeView === view ? 'active' : ''}`}
            onClick={() => onSelectView(view)}
          >
            {VIEW_ICONS[view]}
            <span>{view}</span>
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        <div>Local-first Control Plane</div>
        <div style={{ color: '#3fb950', marginTop: '4px' }}>● Zero Relay Active</div>
      </div>
    </aside>
  );
};
