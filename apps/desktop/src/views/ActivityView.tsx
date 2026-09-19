import React, { useState, useEffect } from 'react';
import { AuditEvent } from '@remote-commander/shared-types';
import { Bridge, ToolCallRecord } from '../bridge.js';
import {
  Activity,
  RefreshCw,
  ShieldAlert,
  CheckCircle,
  Play,
  XCircle,
  Clock,
  Wrench,
} from 'lucide-react';

export const ActivityView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'audit' | 'tool_calls'>('audit');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [auditData, toolCallData] = await Promise.all([
        Bridge.listAuditEvents(50),
        Bridge.listToolCalls(50),
      ]);
      setEvents(auditData);
      setToolCalls(toolCallData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getEventBadge = (type: string) => {
    switch (type) {
      case 'TOOL_APPROVED':
      case 'APPROVAL_GRANTED':
        return (
          <span style={{ color: '#3fb950', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle size={14} /> Approved
          </span>
        );
      case 'TOOL_INVOKED':
      case 'TOOL_EXECUTED':
        return (
          <span style={{ color: '#58a6ff', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Play size={14} /> Executed
          </span>
        );
      case 'TOOL_EVALUATED':
        return (
          <span style={{ color: '#8b949e', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={14} /> Evaluated
          </span>
        );
      case 'APPROVAL_REQUESTED':
        return (
          <span style={{ color: '#d29922', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={14} /> Approval Required
          </span>
        );
      case 'APPROVAL_REJECTED':
      case 'TOOL_DENIED':
        return (
          <span style={{ color: '#f85149', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <XCircle size={14} /> Denied/Rejected
          </span>
        );
      case 'SECURITY_VIOLATION':
        return (
          <span style={{ color: '#f85149', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ShieldAlert size={14} /> Violation
          </span>
        );
      default:
        return <span>{type}</span>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span
            className="status-badge"
            style={{ backgroundColor: 'rgba(63,185,80,0.15)', color: '#3fb950' }}
          >
            Completed
          </span>
        );
      case 'PENDING':
        return (
          <span
            className="status-badge"
            style={{ backgroundColor: 'rgba(210,153,34,0.15)', color: '#d29922' }}
          >
            Pending Approval
          </span>
        );
      case 'REJECTED':
      case 'FAILED':
      case 'CANCELLED':
        return <span className="status-badge status-prod">Rejected/Failed</span>;
      default:
        return <span className="status-badge">{status}</span>;
    }
  };

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'CRITICAL':
        return <span style={{ color: '#f85149', fontWeight: 600 }}>CRITICAL</span>;
      case 'HIGH':
        return <span style={{ color: '#d29922', fontWeight: 600 }}>HIGH</span>;
      case 'MEDIUM':
        return <span style={{ color: '#e3b341' }}>MEDIUM</span>;
      case 'LOW':
        return <span style={{ color: '#58a6ff' }}>LOW</span>;
      default:
        return <span style={{ color: '#3fb950' }}>READ_ONLY</span>;
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={20} color="#58a6ff" />
          <h2>Audit & Tool Activity Log</h2>
        </div>
        <button
          className="btn"
          onClick={loadData}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          className={`btn ${activeTab === 'audit' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('audit')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Activity size={14} /> Immutable Audit Events ({events.length})
        </button>
        <button
          className={`btn ${activeTab === 'tool_calls' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('tool_calls')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Wrench size={14} /> Tool Calls ({toolCalls.length})
        </button>
      </div>

      {activeTab === 'audit' ? (
        <div className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Tool Name</th>
                <th>Server Target</th>
                <th>Audit Details</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: 'center', color: '#8b949e', padding: '24px' }}
                  >
                    No audit events recorded yet.
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr key={ev.id}>
                    <td style={{ color: '#8b949e', whiteSpace: 'nowrap' }}>
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </td>
                    <td>{getEventBadge(ev.eventType)}</td>
                    <td style={{ fontWeight: 600, color: '#58a6ff' }}>{ev.toolName ?? '-'}</td>
                    <td>{ev.serverId ?? 'local'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8b949e' }}>
                      {ev.detailsJson}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Requested At</th>
                <th>Tool Name</th>
                <th>Risk Level</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Target</th>
                <th>Arguments</th>
              </tr>
            </thead>
            <tbody>
              {toolCalls.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{ textAlign: 'center', color: '#8b949e', padding: '24px' }}
                  >
                    No tool calls executed yet.
                  </td>
                </tr>
              ) : (
                toolCalls.map((tc) => (
                  <tr key={tc.id}>
                    <td style={{ color: '#8b949e', whiteSpace: 'nowrap' }}>
                      {new Date(tc.requested_at).toLocaleTimeString()}
                    </td>
                    <td style={{ fontWeight: 600, color: '#58a6ff' }}>{tc.tool_name}</td>
                    <td>{getRiskBadge(tc.risk_level)}</td>
                    <td>{getStatusBadge(tc.status)}</td>
                    <td>{tc.duration_ms !== undefined ? `${tc.duration_ms}ms` : '-'}</td>
                    <td>{tc.server_id ?? 'local'}</td>
                    <td
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        color: '#8b949e',
                        maxWidth: '300px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {tc.arguments_json}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
