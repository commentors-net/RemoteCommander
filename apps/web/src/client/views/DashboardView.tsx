import React, { useEffect, useState } from 'react';
import {
  Cpu,
  HardDrive,
  Clock,
  Server,
  RefreshCw,
  FolderTree,
  MessageSquare,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { apiRequest } from '../api.js';

interface DashboardViewProps {
  onNavigate: (tab: any) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const [metrics, setMetrics] = useState<any>(null);
  const [whmStatus, setWhmStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sysRes, whmRes] = await Promise.allSettled([
        apiRequest('/api/system/status'),
        apiRequest('/api/whm/status'),
      ]);

      if (sysRes.status === 'fulfilled') {
        setMetrics(sysRes.value.data);
      } else {
        setError(sysRes.reason?.message || 'Failed to load system metrics');
      }

      if (whmRes.status === 'fulfilled') {
        setWhmStatus(whmRes.value.data);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <div className="view-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Local Server Operations Hub</h2>
          <p style={{ fontSize: '13px', color: '#8b949e', marginTop: '4px' }}>
            Single-host monitoring, website file governance, and WHM API management.
          </p>
        </div>
        <button type="button" className="btn" onClick={loadData} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid #da3633', backgroundColor: 'rgba(218, 54, 51, 0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f85149' }}>
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* CPU & Load */}
        <div className="card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#8b949e', textTransform: 'uppercase', fontWeight: 600 }}>CPU Load Average</span>
            <Cpu size={18} color="#58a6ff" />
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#c9d1d9' }}>
            {metrics ? `${metrics.loadAverage?.[0]?.toFixed(2) ?? '0.00'}` : '...'}
          </div>
          <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '6px' }}>
            {metrics ? `${metrics.cpuCores} cores • 5m: ${metrics.loadAverage?.[1]?.toFixed(2)} • 15m: ${metrics.loadAverage?.[2]?.toFixed(2)}` : 'Loading...'}
          </div>
        </div>

        {/* Memory */}
        <div className="card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#8b949e', textTransform: 'uppercase', fontWeight: 600 }}>Memory Usage</span>
            <Server size={18} color="#3fb950" />
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#c9d1d9' }}>
            {metrics ? `${metrics.memory?.usedPercent ?? 0}%` : '...'}
          </div>
          <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '6px' }}>
            {metrics ? `${Math.round(metrics.memory.usedBytes / 1024 / 1024)}MB / ${Math.round(metrics.memory.totalBytes / 1024 / 1024)}MB` : 'Loading...'}
          </div>
        </div>

        {/* Disk */}
        <div className="card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#8b949e', textTransform: 'uppercase', fontWeight: 600 }}>Disk Usage</span>
            <HardDrive size={18} color="#d29922" />
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#c9d1d9' }}>
            {metrics ? `${metrics.disk?.percentUsed ?? 0}%` : '...'}
          </div>
          <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '6px' }}>
            {metrics ? `${metrics.disk.usedGb}GB used / ${metrics.disk.totalGb}GB total (${metrics.disk.freeGb}GB free)` : 'Loading...'}
          </div>
        </div>

        {/* Uptime */}
        <div className="card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#8b949e', textTransform: 'uppercase', fontWeight: 600 }}>System Uptime</span>
            <Clock size={18} color="#bc8cff" />
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#c9d1d9' }}>
            {metrics ? formatUptime(metrics.uptimeSeconds) : '...'}
          </div>
          <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '6px' }}>
            {metrics ? `OS: ${metrics.platform}` : 'Loading...'}
          </div>
        </div>
      </div>

      {/* WHM Status & Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        {/* WHM Integration Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={20} color="#58a6ff" />
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>cPanel & WHM Integration</h3>
            </div>
            {whmStatus?.connected ? (
              <span className="badge badge-success">Active & Verified</span>
            ) : (
              <span className="badge badge-warning">Token Not Configured</span>
            )}
          </div>

          <p style={{ fontSize: '13px', color: '#8b949e', lineHeight: '1.5', marginBottom: '16px' }}>
            {whmStatus?.connected
              ? `Connected directly via local loopback HTTPS (port 2087). Running cPanel/WHM version ${whmStatus.version} with ${whmStatus.accountsCount ?? 0} active accounts.`
              : 'Configure your WHM API 1 token in Settings to enable account provisioning, service restarts, and server-wide administration.'}
          </p>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNavigate('whm')}
            >
              Manage Accounts & WHM
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onNavigate('settings')}
            >
              Configure Token
            </button>
          </div>
        </div>

        {/* AI Assistant Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={20} color="#bc8cff" />
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>AI Server Assistant</h3>
            </div>
            <span className="badge badge-success">gpt-5-mini</span>
          </div>

          <p style={{ fontSize: '13px', color: '#8b949e', lineHeight: '1.5', marginBottom: '16px' }}>
            Ask natural language questions to inspect disk partitions, search website logs, check Apache health, or automate file modifications safely.
          </p>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNavigate('chat')}
            >
              Open AI Chat
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onNavigate('files')}
            >
              <FolderTree size={14} />
              Website Files
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
