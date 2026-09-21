import React, { useState, useEffect } from 'react';
import { AuditEvent } from '@remote-commander/shared-types';
import { Bridge, ToolCallRecord, SafetyBackupRecord } from '../bridge.js';
import {
  Activity,
  RefreshCw,
  ShieldAlert,
  CheckCircle,
  Play,
  XCircle,
  Clock,
  Wrench,
  RotateCcw,
  ShieldCheck,
  Download,
  FileText,
  Copy,
  Check,
} from 'lucide-react';

export const ActivityView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'audit' | 'tool_calls' | 'backups' | 'system_logs'>(
    'audit',
  );
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [backups, setBackups] = useState<SafetyBackupRecord[]>([]);
  const [logInfo, setLogInfo] = useState<{ logFilePath: string; recentLines: string[] }>({
    logFilePath: '',
    recentLines: [],
  });
  const [copiedLogPath, setCopiedLogPath] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ text: string; isError: boolean } | null>(
    null,
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const [auditData, toolCallData, backupData, logs] = await Promise.all([
        Bridge.listAuditEvents(50),
        Bridge.listToolCalls(50),
        Bridge.safetyListBackups(),
        Bridge.getLogInfo(),
      ]);
      setEvents(auditData);
      setToolCalls(toolCallData);
      setBackups(backupData);
      setLogInfo(logs);
    } finally {
      setLoading(false);
    }
  };

  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  const handleExportAudit = async (format: 'json' | 'csv') => {
    setExportingFormat(format);
    try {
      const data = await Bridge.exportAuditLog(format);
      const blob = new Blob([data], {
        type: format === 'json' ? 'application/json' : 'text/csv',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `remotecommander-audit-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(`Export failed: ${(err as Error)?.message ?? String(err)}`);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleRestore = async (backup: SafetyBackupRecord) => {
    if (
      !window.confirm(
        `Are you sure you want to restore '${backup.file_path}' from backup '${backup.backup_path}' on server '${backup.server_id}'?`,
      )
    ) {
      return;
    }
    setRestoringBackupId(backup.id);
    setRestoreMessage(null);
    try {
      await Bridge.safetyRestoreBackup(backup.server_id, backup.file_path, backup.backup_path);
      setRestoreMessage({
        text: `Successfully restored ${backup.file_path} from ${backup.backup_path}`,
        isError: false,
      });
      await loadData();
    } catch (err: unknown) {
      setRestoreMessage({
        text: `Failed to restore: ${(err as Error)?.message ?? String(err)}`,
        isError: true,
      });
    } finally {
      setRestoringBackupId(null);
      setTimeout(() => setRestoreMessage(null), 4000);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleExportAudit('json')}
            disabled={exportingFormat !== null}
            title="Export full audit log as JSON"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
          >
            <Download size={13} /> Export JSON
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleExportAudit('csv')}
            disabled={exportingFormat !== null}
            title="Export full audit log as CSV"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
          >
            <Download size={13} /> Export CSV
          </button>
          <button
            className="btn"
            onClick={loadData}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
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
        <button
          className={`btn ${activeTab === 'backups' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('backups')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <ShieldCheck size={14} /> Safety & Backups ({backups.length})
        </button>
        <button
          className={`btn ${activeTab === 'system_logs' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('system_logs')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <FileText size={14} /> Error & System Logs ({logInfo.recentLines.length})
        </button>
      </div>

      {restoreMessage && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: '16px',
            borderRadius: '6px',
            backgroundColor: restoreMessage.isError
              ? 'rgba(248, 81, 73, 0.15)'
              : 'rgba(63, 185, 80, 0.15)',
            border: `1px solid ${restoreMessage.isError ? '#f85149' : '#3fb950'}`,
            color: restoreMessage.isError ? '#f85149' : '#3fb950',
            fontSize: '13px',
          }}
        >
          {restoreMessage.text}
        </div>
      )}

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
      ) : activeTab === 'tool_calls' ? (
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
      ) : (
        <div className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Created At</th>
                <th>Server</th>
                <th>Original File</th>
                <th>Backup File Path</th>
                <th>Reason / Created By</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {backups.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{ textAlign: 'center', color: '#8b949e', padding: '24px' }}
                  >
                    No safety backups created yet.
                  </td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.id}>
                    <td style={{ color: '#8b949e', whiteSpace: 'nowrap' }}>
                      {new Date(b.created_at).toLocaleTimeString()}
                    </td>
                    <td>{b.server_id}</td>
                    <td style={{ fontWeight: 600, color: '#58a6ff' }}>{b.file_path}</td>
                    <td
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        color: '#8b949e',
                      }}
                    >
                      {b.backup_path}
                    </td>
                    <td style={{ fontSize: '12px' }}>
                      <div>{b.reason}</div>
                      <div style={{ color: '#8b949e', fontSize: '11px' }}>by {b.created_by}</div>
                    </td>
                    <td>
                      {b.restored ? (
                        <span
                          className="status-badge"
                          style={{ backgroundColor: 'rgba(210,153,34,0.15)', color: '#d29922' }}
                        >
                          Restored
                        </span>
                      ) : (
                        <span
                          className="status-badge"
                          style={{ backgroundColor: 'rgba(63,185,80,0.15)', color: '#3fb950' }}
                        >
                          Active
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn"
                        style={{
                          fontSize: '12px',
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                        disabled={restoringBackupId === b.id}
                        onClick={() => handleRestore(b)}
                        title="Restore this file from backup"
                      >
                        <RotateCcw
                          size={12}
                          className={restoringBackupId === b.id ? 'animate-spin' : ''}
                        />
                        Restore
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'system_logs' && (
        <div>
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#161b22',
              borderRadius: '6px',
              border: '1px solid #30363d',
              marginBottom: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '11px',
                  color: '#8b949e',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                }}
              >
                On-Disk Log File Location
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  color: '#58a6ff',
                  marginTop: '4px',
                }}
              >
                {logInfo.logFilePath || 'Loading log path...'}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
              onClick={() => {
                navigator.clipboard.writeText(logInfo.logFilePath);
                setCopiedLogPath(true);
                setTimeout(() => setCopiedLogPath(false), 2000);
              }}
            >
              {copiedLogPath ? <Check size={14} color="#3fb950" /> : <Copy size={14} />}
              {copiedLogPath ? 'Copied!' : 'Copy Path'}
            </button>
          </div>

          <div
            style={{
              padding: '12px',
              backgroundColor: '#0d1117',
              borderRadius: '6px',
              border: '1px solid #30363d',
              fontFamily: 'monospace',
              fontSize: '12px',
              maxHeight: '540px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {logInfo.recentLines.length === 0 ? (
              <div style={{ color: '#8b949e', textAlign: 'center', padding: '24px' }}>
                No errors or diagnostic logs recorded yet.
              </div>
            ) : (
              logInfo.recentLines.map((line, idx) => {
                const isError = line.includes('[ERROR]');
                const isWarn = line.includes('[WARN]');
                const isInfo = line.includes('[INFO]');
                return (
                  <div
                    key={idx}
                    style={{
                      padding: '4px 6px',
                      borderRadius: '4px',
                      marginBottom: '2px',
                      color: isError
                        ? '#f85149'
                        : isWarn
                          ? '#d29922'
                          : isInfo
                            ? '#79c0ff'
                            : '#c9d1d9',
                      backgroundColor: isError ? 'rgba(248,81,73,0.08)' : 'transparent',
                    }}
                  >
                    {line}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
