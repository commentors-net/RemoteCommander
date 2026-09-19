import React, { useState } from 'react';
import {
  ServerProfile,
  ServerEnvironment,
  ConnectionTestResult,
  DiscoveredSshHost,
} from '@remote-commander/shared-types';
import { Bridge } from '../bridge.js';
import {
  Plus,
  Trash2,
  Globe,
  Wifi,
  AlertTriangle,
  RefreshCw,
  Download,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

interface ServersViewProps {
  servers: ServerProfile[];
  onAddServer: (server: ServerProfile) => void;
  onDeleteServer: (id: string) => void;
}

export const ServersView: React.FC<ServersViewProps> = ({
  servers,
  onAddServer,
  onDeleteServer,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredSshHost[]>([]);
  const [loadingDiscovered, setLoadingDiscovered] = useState(false);

  // Server Form State
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [environment, setEnvironment] = useState<ServerEnvironment>('STAGING');
  const [sshConfigAlias, setSshConfigAlias] = useState('');
  const [cpanelEnabled, setCpanelEnabled] = useState(false);

  // Connection Test & Verification State
  const [testResults, setTestResults] = useState<
    Record<string, { loading: boolean; result?: ConnectionTestResult; error?: string }>
  >({});
  const [mismatchModal, setMismatchModal] = useState<ConnectionTestResult | null>(null);

  const handleTestConnection = async (server: ServerProfile) => {
    setTestResults((prev) => ({
      ...prev,
      [server.id]: { loading: true },
    }));

    try {
      const result = await Bridge.testServerConnection(server.id);
      setTestResults((prev) => ({
        ...prev,
        [server.id]: { loading: false, result },
      }));

      // Security Gate E: Trigger mismatch modal if fingerprint changed
      if (result.hostKeyStatus === 'CHANGED_WARNING') {
        setMismatchModal(result);
      }
    } catch (err: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [server.id]: {
          loading: false,
          error: (err as Error)?.message ?? 'Connection probe failed',
        },
      }));
    }
  };

  const handleAcceptHostKey = async (testRes: ConnectionTestResult) => {
    if (!testRes.hostKey) return;
    try {
      await Bridge.acceptServerHostKey(testRes.serverId, testRes.hostKey);
      setMismatchModal(null);
      // Retest connection after acceptance
      const srv = servers.find((s) => s.id === testRes.serverId);
      if (srv) {
        await handleTestConnection(srv);
      }
    } catch (err) {
      alert(`Failed to save host key: ${(err as Error)?.message}`);
    }
  };

  const handleFetchDiscovered = async () => {
    setShowImport(true);
    setLoadingDiscovered(true);
    try {
      const discovered = await Bridge.listDiscoveredSshConfigHosts();
      setDiscoveredHosts(discovered);
    } catch {
      setDiscoveredHosts([]);
    } finally {
      setLoadingDiscovered(false);
    }
  };

  const handleImportDiscovered = (h: DiscoveredSshHost) => {
    const newServer: ServerProfile = {
      id: `srv-ssh-${Date.now()}`,
      name: h.alias,
      hostname: h.hostname,
      port: h.port || 22,
      username: h.username || 'root',
      environment: 'STAGING',
      authMethod: 'SSH_KEY',
      sshKeyPath: h.identityFile || '~/.ssh/id_ed25519',
      sshConfigAlias: h.alias,
      credentialRef: `vault:ssh:${h.alias}`,
      cpanelEnabled: false,
      tags: ['imported', 'ssh-config'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onAddServer(newServer);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !hostname) return;

    const newServer: ServerProfile = {
      id: `srv-${Date.now()}`,
      name,
      hostname,
      port,
      username,
      environment,
      authMethod: 'SSH_KEY',
      credentialRef: `vault:ssh:${name}`,
      sshKeyPath: '~/.ssh/id_ed25519',
      sshConfigAlias: sshConfigAlias.trim() || undefined,
      cpanelEnabled,
      whmPort: cpanelEnabled ? 2087 : undefined,
      tags: [environment.toLowerCase(), cpanelEnabled ? 'cpanel' : 'standard'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onAddServer(newServer);
    setName('');
    setHostname('');
    setPort(22);
    setSshConfigAlias('');
    setShowAdd(false);
  };

  return (
    <div>
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2>Server Inventory</h2>
          <p style={{ color: '#8b949e', fontSize: '13px', marginTop: '4px' }}>
            Manage target servers with direct SSH connectivity and authoritative host verification
            (Gate E).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn" onClick={handleFetchDiscovered}>
            <Download size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Import from ~/.ssh/config
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
            <Plus size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Add Server Profile
          </button>
        </div>
      </div>

      {/* Discovered SSH Config Hosts Modal / Panel */}
      {showImport && (
        <div
          className="panel-card"
          style={{
            marginBottom: '20px',
            backgroundColor: '#161b22',
            border: '1px solid #30363d',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}
          >
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Download size={18} color="#58a6ff" /> Discovered Hosts in ~/.ssh/config
            </h3>
            <button
              className="btn"
              style={{ padding: '2px 8px' }}
              onClick={() => setShowImport(false)}
            >
              Close
            </button>
          </div>
          {loadingDiscovered ? (
            <p style={{ color: '#8b949e' }}>Scanning local ~/.ssh/config...</p>
          ) : discoveredHosts.length === 0 ? (
            <p style={{ color: '#8b949e' }}>No host aliases found in ~/.ssh/config.</p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '10px',
              }}
            >
              {discoveredHosts.map((h) => {
                const alreadyAdded = servers.some(
                  (s) => s.name === h.alias || s.hostname === h.hostname,
                );
                return (
                  <div
                    key={h.alias}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#0d1117',
                      borderRadius: '6px',
                      border: '1px solid #21262d',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#f0f6fc' }}>{h.alias}</div>
                      <div style={{ fontSize: '12px', color: '#8b949e' }}>
                        {h.username ? `${h.username}@` : ''}
                        {h.hostname}:{h.port}
                      </div>
                    </div>
                    <button
                      className="btn"
                      disabled={alreadyAdded}
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                      onClick={() => handleImportDiscovered(h)}
                    >
                      {alreadyAdded ? 'Added' : 'Import'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Server Form */}
      {showAdd && (
        <div className="panel-card" style={{ marginBottom: '20px' }}>
          <h3 style={{ marginBottom: '16px' }}>Add Target Server Profile</h3>
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#8b949e' }}>
                  Server Name
                </label>
                <input
                  type="text"
                  className="chat-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. production-cpanel-01"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#8b949e' }}>
                  Hostname / IP
                </label>
                <input
                  type="text"
                  className="chat-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. 198.51.100.15"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#8b949e' }}>
                  SSH Port
                </label>
                <input
                  type="number"
                  className="chat-input"
                  style={{ width: '100%' }}
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value, 10) || 22)}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#8b949e' }}>
                  SSH Username
                </label>
                <input
                  type="text"
                  className="chat-input"
                  style={{ width: '100%' }}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#8b949e' }}>
                  Environment
                </label>
                <select
                  className="chat-input"
                  style={{ width: '100%', height: '42px' }}
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as ServerEnvironment)}
                >
                  <option value="DEVELOPMENT">DEVELOPMENT</option>
                  <option value="STAGING">STAGING</option>
                  <option value="PRODUCTION">PRODUCTION (Strict Approval)</option>
                  <option value="BACKUP">BACKUP</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: '#8b949e' }}>
                  ~/.ssh/config Alias (Optional)
                </label>
                <input
                  type="text"
                  className="chat-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. prod-cpanel"
                  value={sshConfigAlias}
                  onChange={(e) => setSshConfigAlias(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0' }}>
              <input
                type="checkbox"
                id="cpanel-cb"
                checked={cpanelEnabled}
                onChange={(e) => setCpanelEnabled(e.target.checked)}
              />
              <label htmlFor="cpanel-cb">
                Enable WHM / cPanel API Integration (Default Port 2087)
              </label>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button type="submit" className="btn btn-primary">
                Save Server Profile
              </button>
              <button type="button" className="btn" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Security Gate E Host Key Mismatch Alert Modal */}
      {mismatchModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            className="panel-card"
            style={{
              maxWidth: '620px',
              width: '100%',
              backgroundColor: '#161b22',
              border: '2px solid #da3633',
              boxShadow: '0 0 24px rgba(218, 54, 51, 0.4)',
            }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}
            >
              <ShieldAlert size={28} color="#f85149" />
              <div>
                <h3 style={{ color: '#f85149', margin: 0 }}>
                  SECURITY GATE E: HOST KEY MISMATCH DETECTED
                </h3>
                <div style={{ color: '#8b949e', fontSize: '13px' }}>
                  Target Server: {mismatchModal.serverName} ({mismatchModal.hostname}:
                  {mismatchModal.port})
                </div>
              </div>
            </div>

            <p style={{ color: '#c9d1d9', fontSize: '14px', lineHeight: '1.5' }}>
              The SSH host key presented by the remote server differs from the trusted key recorded
              in your system. This indicates a{' '}
              <strong>potential Man-In-The-Middle (MITM) attack</strong>, DNS spoofing, or an
              uncoordinated server re-installation.
            </p>

            <div
              style={{
                backgroundColor: '#0d1117',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid #30363d',
                fontFamily: 'monospace',
                fontSize: '12px',
                margin: '16px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div>
                <span style={{ color: '#8b949e' }}>Previous Trusted Fingerprint:</span>
                <div style={{ color: '#3fb950', wordBreak: 'break-all' }}>
                  {mismatchModal.previousFingerprint || 'Unknown'}
                </div>
              </div>
              <div>
                <span style={{ color: '#8b949e' }}>Offered Fingerprint from Server:</span>
                <div style={{ color: '#f85149', wordBreak: 'break-all' }}>
                  {mismatchModal.newFingerprint || 'Unknown'}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
                marginTop: '16px',
              }}
            >
              <button
                className="btn"
                style={{ backgroundColor: '#21262d', color: '#f0f6fc' }}
                onClick={() => setMismatchModal(null)}
              >
                Abort & Keep Blocked (Recommended)
              </button>
              <button className="btn btn-danger" onClick={() => handleAcceptHostKey(mismatchModal)}>
                Override & Trust New Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Servers Table */}
      <div className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Host / Port</th>
              <th>User</th>
              <th>Environment</th>
              <th>SSH Status & Host Key</th>
              <th>cPanel / WHM</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => {
              const test = testResults[s.id];
              return (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>
                    <div>{s.name}</div>
                    {s.sshConfigAlias && (
                      <div style={{ fontSize: '11px', color: '#8b949e' }}>
                        config: {s.sshConfigAlias}
                      </div>
                    )}
                  </td>
                  <td>
                    {s.hostname}:{s.port}
                  </td>
                  <td>{s.username}</td>
                  <td>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: s.environment === 'PRODUCTION' ? '#da363326' : '#23863626',
                        color: s.environment === 'PRODUCTION' ? '#f85149' : '#3fb950',
                        border:
                          s.environment === 'PRODUCTION'
                            ? '1px solid #da363366'
                            : '1px solid #23863666',
                      }}
                    >
                      {s.environment}
                    </span>
                  </td>

                  {/* SSH Connection Test & Host Key status */}
                  <td>
                    {test?.loading ? (
                      <span
                        style={{
                          color: '#58a6ff',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <RefreshCw size={13} className="spin" /> Probing SSH...
                      </span>
                    ) : test?.result ? (
                      <div>
                        {test.result.hostKeyStatus === 'TRUSTED' && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              color: '#3fb950',
                              fontSize: '12px',
                            }}
                            title={`Fingerprint: ${test.result.hostKey?.fingerprintSha256}`}
                          >
                            <ShieldCheck size={14} /> Connected ({test.result.latencyMs}ms)
                          </div>
                        )}
                        {test.result.hostKeyStatus === 'NEW_HOST' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#58a6ff', fontSize: '12px' }}>
                              New Host ({test.result.latencyMs}ms)
                            </span>
                            <button
                              className="btn"
                              style={{ padding: '2px 6px', fontSize: '11px' }}
                              onClick={() => handleAcceptHostKey(test.result!)}
                            >
                              Trust Key
                            </button>
                          </div>
                        )}
                        {test.result.hostKeyStatus === 'CHANGED_WARNING' && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              color: '#f85149',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                            onClick={() => setMismatchModal(test.result!)}
                          >
                            <AlertTriangle size={14} /> Host Key Mismatch!
                          </div>
                        )}
                        {test.result.hostKey?.fingerprintSha256 && (
                          <div
                            style={{
                              fontSize: '10px',
                              color: '#8b949e',
                              fontFamily: 'monospace',
                              marginTop: '2px',
                              maxWidth: '180px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={test.result.hostKey.fingerprintSha256}
                          >
                            {test.result.hostKey.fingerprintSha256}
                          </div>
                        )}
                      </div>
                    ) : test?.error ? (
                      <div style={{ color: '#f85149', fontSize: '12px' }} title={test.error}>
                        Connection Failed
                      </div>
                    ) : (
                      <span style={{ color: '#8b949e', fontSize: '12px' }}>Not tested</span>
                    )}
                  </td>

                  <td>
                    {s.cpanelEnabled ? (
                      <span
                        style={{
                          color: '#58a6ff',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Globe size={14} /> WHM :{s.whmPort ?? 2087}
                      </span>
                    ) : (
                      <span style={{ color: '#8b949e' }}>Disabled</span>
                    )}
                  </td>

                  <td style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn"
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      onClick={() => handleTestConnection(s)}
                      disabled={test?.loading}
                      title="Test SSH Connection & Verify Host Key (M5)"
                    >
                      <Wifi size={13} /> Test
                    </button>
                    <button
                      className="btn"
                      style={{ padding: '4px 8px', color: '#f85149' }}
                      onClick={() => onDeleteServer(s.id)}
                      title="Delete Server"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
