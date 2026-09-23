import React from 'react';
import { Server, Activity, LogOut, CheckCircle2, AlertCircle } from 'lucide-react';
import { clearAuthToken } from '../api.js';

interface HeaderProps {
  whmConnected: boolean;
  whmVersion?: string;
  uptimeText?: string;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  whmConnected,
  whmVersion,
  uptimeText,
  onLogout,
}) => {
  return (
    <div className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Activity size={16} color="#3fb950" />
          <span style={{ fontSize: '13px', color: '#8b949e' }}>
            System Status: <strong style={{ color: '#3fb950' }}>Operational</strong>
          </span>
          {uptimeText && (
            <span style={{ fontSize: '12px', color: '#8b949e', marginLeft: '6px' }}>
              ({uptimeText})
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Server size={15} color={whmConnected ? '#3fb950' : '#d29922'} />
          <span style={{ fontSize: '13px', color: '#8b949e' }}>
            WHM Loopback:
          </span>
          {whmConnected ? (
            <span className="badge badge-success">
              <CheckCircle2 size={12} /> Connected {whmVersion ? `v${whmVersion}` : ''}
            </span>
          ) : (
            <span className="badge badge-warning">
              <AlertCircle size={12} /> Disconnected
            </span>
          )}
        </div>
      </div>

      <div>
        <button
          type="button"
          className="btn"
          style={{ fontSize: '12px', padding: '4px 10px' }}
          onClick={() => {
            clearAuthToken();
            onLogout();
          }}
        >
          <LogOut size={14} />
          Lock / Logout
        </button>
      </div>
    </div>
  );
};
