import React, { useEffect, useState } from 'react';
import {
  Server,
  UserPlus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Activity,
  Globe,
  HardDrive,
  ShieldAlert,
} from 'lucide-react';
import { apiRequest } from '../api.js';

export const WhmView: React.FC = () => {
  const [whmStatus, setWhmStatus] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAccount, setNewAccount] = useState({
    username: '',
    domain: '',
    password: '',
    plan: 'default',
    contactEmail: '',
  });
  const [creating, setCreating] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadWhmData = async () => {
    setLoading(true);
    setActionMessage(null);
    try {
      const [statusRes, acctsRes, servicesRes] = await Promise.allSettled([
        apiRequest('/api/whm/status'),
        apiRequest('/api/whm/accounts'),
        apiRequest('/api/whm/services'),
      ]);

      if (statusRes.status === 'fulfilled') {
        setWhmStatus(statusRes.value.data);
      }
      if (acctsRes.status === 'fulfilled') {
        setAccounts(acctsRes.value.data || []);
      }
      if (servicesRes.status === 'fulfilled') {
        setServices(servicesRes.value.data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWhmData();
  }, []);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccount.username || !newAccount.domain) return;

    setCreating(true);
    setActionMessage(null);
    try {
      const res = await apiRequest('/api/whm/create-account', {
        method: 'POST',
        body: JSON.stringify(newAccount),
      });

      if (res.success) {
        setActionMessage({ text: `Account created: ${newAccount.username} (${newAccount.domain})`, type: 'success' });
        setShowCreateModal(false);
        setNewAccount({ username: '', domain: '', password: '', plan: 'default', contactEmail: '' });
        loadWhmData();
      } else {
        setActionMessage({ text: res.message || 'Failed to create account', type: 'error' });
      }
    } catch (err: any) {
      setActionMessage({ text: err.message || 'Error communicating with WHM API', type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="view-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600 }}>cPanel & WHM Administration</h2>
          <p style={{ fontSize: '13px', color: '#8b949e', marginTop: '4px' }}>
            Direct loopback HTTPS management on port 2087 with stored WHM API token.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn" onClick={loadWhmData} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
            disabled={!whmStatus?.connected}
          >
            <UserPlus size={14} />
            Create Hosting User
          </button>
        </div>
      </div>

      {actionMessage && (
        <div
          className="card"
          style={{
            borderLeft: actionMessage.type === 'success' ? '4px solid #238636' : '4px solid #da3633',
            backgroundColor: actionMessage.type === 'success' ? 'rgba(35, 134, 54, 0.1)' : 'rgba(218, 54, 51, 0.1)',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: actionMessage.type === 'success' ? '#3fb950' : '#f85149',
          }}
        >
          {actionMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* WHM Status Summary */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '8px',
              background: '#1f242c',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Server size={22} color={whmStatus?.connected ? '#3fb950' : '#d29922'} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 600, fontSize: '15px' }}>WHM API 1 Gateway</span>
              {whmStatus?.connected ? (
                <span className="badge badge-success">
                  <CheckCircle2 size={12} /> Connected (v{whmStatus.version})
                </span>
              ) : (
                <span className="badge badge-warning">
                  <AlertCircle size={12} /> Disconnected / No Token
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>
              Target: <code>https://127.0.0.1:2087/json-api/</code> • Total Accounts: <strong>{accounts.length}</strong>
            </div>
          </div>
        </div>

        {whmStatus?.error && (
          <div style={{ fontSize: '12px', color: '#f85149', maxWidth: '300px', textAlign: 'right' }}>
            {whmStatus.error}
          </div>
        )}
      </div>

      {/* Accounts Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '24px' }}>
        <div style={{ padding: '12px 16px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Globe size={16} color="#58a6ff" />
          <span style={{ fontWeight: 600, fontSize: '13px' }}>Hosted cPanel Accounts ({accounts.length})</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Primary Domain</th>
                <th>Hosting Plan</th>
                <th>Disk Usage</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => {
                const isSuspended = acc.suspended === 1 || acc.suspended === '1';
                return (
                  <tr key={acc.user}>
                    <td style={{ fontWeight: 600, color: '#c9d1d9' }}>{acc.user}</td>
                    <td>
                      <a
                        href={`https://${acc.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#58a6ff', textDecoration: 'none' }}
                      >
                        {acc.domain}
                      </a>
                    </td>
                    <td>
                      <span className="badge" style={{ background: '#1f242c', color: '#8b949e' }}>
                        {acc.plan}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px', color: '#8b949e' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <HardDrive size={13} />
                        {acc.diskused} / {acc.disklimit}
                      </div>
                    </td>
                    <td>
                      {isSuspended ? (
                        <span className="badge badge-danger">
                          <ShieldAlert size={12} /> Suspended
                        </span>
                      ) : (
                        <span className="badge badge-success">
                          <CheckCircle2 size={12} /> Active
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {accounts.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#8b949e' }}>
                    No accounts found or WHM token not authorized.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Services Monitor */}
      {services.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Activity size={16} color="#3fb950" />
            <h3 style={{ fontSize: '14px', fontWeight: 600 }}>Server Services Health</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            {services.map((svc: any) => (
              <div
                key={svc.name}
                style={{
                  padding: '8px 12px',
                  background: '#1f242c',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontSize: '12px', fontWeight: 500 }}>{svc.name}</span>
                <span className="badge badge-success" style={{ fontSize: '10px' }}>
                  Running
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Account Modal */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>Provision New Hosting User</h3>
            <p style={{ fontSize: '12px', color: '#8b949e', marginBottom: '16px' }}>
              Creates a new cPanel user, domain vhost, and public_html directory via WHM API 1.
            </p>

            <form onSubmit={handleCreateAccount}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Username
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={newAccount.username}
                  onChange={(e) => setNewAccount({ ...newAccount, username: e.target.value })}
                  placeholder="e.g. clientbiz"
                  required
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Primary Domain
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={newAccount.domain}
                  onChange={(e) => setNewAccount({ ...newAccount, domain: e.target.value })}
                  placeholder="e.g. clientbiz.com"
                  required
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Password (Optional, random if omitted)
                </label>
                <input
                  type="password"
                  className="input-field"
                  value={newAccount.password}
                  onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                  placeholder="Strong account password"
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Hosting Package Plan
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={newAccount.plan}
                  onChange={(e) => setNewAccount({ ...newAccount, plan: e.target.value })}
                  placeholder="default"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating in WHM...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
