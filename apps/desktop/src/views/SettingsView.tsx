import React, { useState, useEffect } from 'react';
import { Bridge } from '../bridge.js';
import { PermissionMode, CredentialReference, SecretType } from '@remote-commander/shared-types';
import { Settings, Save, ShieldCheck, Key, Plus, Trash2, Lock } from 'lucide-react';

interface SettingsViewProps {
  currentMode: PermissionMode;
  onUpdateMode: (mode: PermissionMode) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ currentMode, onUpdateMode }) => {
  const [provider, setProvider] = useState('openai');
  const [hostKeyChecking, setHostKeyChecking] = useState(true);
  const [savedStatus, setSavedStatus] = useState(false);

  // Credentials state
  const [credentials, setCredentials] = useState<CredentialReference[]>([]);
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [newSecretType, setNewSecretType] = useState<SecretType>('AI_API_KEY');
  const [newSecretLabel, setNewSecretLabel] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const [secretSavedMsg, setSecretSavedMsg] = useState(false);

  const loadCredentials = async () => {
    const list = await Bridge.listCredentialRefs();
    setCredentials(list);
  };

  useEffect(() => {
    async function load() {
      const p = await Bridge.getSetting('ai_provider');
      if (p) setProvider(JSON.parse(p));

      const hk = await Bridge.getSetting('ssh_host_key_checking');
      if (hk) setHostKeyChecking(JSON.parse(hk));

      await loadCredentials();
    }
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await Bridge.setSetting('permission_mode', JSON.stringify(currentMode));
    await Bridge.setSetting('ai_provider', JSON.stringify(provider));
    await Bridge.setSetting('ssh_host_key_checking', JSON.stringify(hostKeyChecking));

    setSavedStatus(true);
    setTimeout(() => setSavedStatus(false), 2000);
  };

  const handleAddSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSecretLabel || !newSecretValue) return;

    await Bridge.saveSecret(newSecretType, newSecretLabel, newSecretValue);
    setNewSecretLabel('');
    setNewSecretValue('');
    setShowAddSecret(false);
    setSecretSavedMsg(true);
    setTimeout(() => setSecretSavedMsg(false), 2500);
    await loadCredentials();
  };

  const handleDeleteSecret = async (id: string) => {
    await Bridge.deleteSecret(id);
    await loadCredentials();
  };

  return (
    <div style={{ maxWidth: '850px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
        <Settings size={20} color="#58a6ff" />
        <h2>Application Settings</h2>
      </div>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="panel-card">
          <h3 className="panel-title">Operational Security & Permissions</h3>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Default Permission Mode
            </label>
            <select
              className="chat-input"
              style={{ width: '100%' }}
              value={currentMode}
              onChange={(e) => onUpdateMode(e.target.value as PermissionMode)}
            >
              <option value="SAFE_AUTOMATION">
                Safe Automation (Auto-run READ_ONLY and non-production LOW risk)
              </option>
              <option value="APPROVAL_REQUIRED">
                Approval Required (Prompt user before any state-changing action)
              </option>
              <option value="FULL_ACCESS">
                Full Access (Unattended execution, CRITICAL still requires typed acknowledgement)
              </option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="hk-check"
              checked={hostKeyChecking}
              onChange={(e) => setHostKeyChecking(e.target.checked)}
            />
            <label htmlFor="hk-check" style={{ fontWeight: 500 }}>
              Enforce SSH Host Key Verification (Mandatory Security Invariant)
            </label>
          </div>
        </div>

        <div className="panel-card">
          <h3 className="panel-title">AI Provider Configuration</h3>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
              Primary AI Provider
            </label>
            <select
              className="chat-input"
              style={{ width: '100%' }}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="openai">OpenAI (GPT-4o, o3-mini)</option>
              <option value="anthropic">Anthropic (Claude 3.5 Sonnet)</option>
              <option value="gemini">Google Gemini (Gemini 2.0 Flash / Pro)</option>
              <option value="ollama">Ollama (Local Llama 3 / Qwen)</option>
            </select>
            <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '6px' }}>
              API Keys are stored strictly in the OS native credential store (Windows Credential
              Manager).
            </div>
          </div>
        </div>

        {/* M2: OS Keyring Secret Storage Management */}
        <div className="panel-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Key size={18} color="#58a6ff" />
              <h3 className="panel-title" style={{ margin: 0 }}>
                Native OS Keyring Credentials
              </h3>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '12px', padding: '6px 12px' }}
              onClick={() => setShowAddSecret(!showAddSecret)}
            >
              <Plus size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              Add Keyring Secret
            </button>
          </div>

          <p style={{ color: '#8b949e', fontSize: '13px', marginBottom: '16px' }}>
            Secrets (API keys, SSH passwords, WHM tokens) are stored in the OS credential store
            (Windows Credential Manager). SQLite stores only opaque metadata references.
          </p>

          {secretSavedMsg && (
            <div
              style={{ color: '#3fb950', fontSize: '13px', marginBottom: '12px', fontWeight: 500 }}
            >
              ✓ Secret securely committed to OS Credential Manager.
            </div>
          )}

          {showAddSecret && (
            <div
              style={{
                backgroundColor: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                padding: '16px',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 2fr',
                  gap: '12px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      color: '#8b949e',
                      marginBottom: '4px',
                    }}
                  >
                    Secret Type
                  </label>
                  <select
                    className="chat-input"
                    style={{ width: '100%' }}
                    value={newSecretType}
                    onChange={(e) => setNewSecretType(e.target.value as SecretType)}
                  >
                    <option value="AI_API_KEY">AI Provider API Key</option>
                    <option value="SSH_PASSWORD">SSH Password</option>
                    <option value="SSH_KEY_PASSPHRASE">SSH Key Passphrase</option>
                    <option value="WHM_API_TOKEN">WHM API Token</option>
                    <option value="GENERIC_TOKEN">Generic Token</option>
                  </select>
                </div>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      color: '#8b949e',
                      marginBottom: '4px',
                    }}
                  >
                    Credential Label
                  </label>
                  <input
                    type="text"
                    className="chat-input"
                    style={{ width: '100%' }}
                    placeholder="e.g. OpenAI API Key - Production"
                    value={newSecretLabel}
                    onChange={(e) => setNewSecretLabel(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: '#8b949e',
                    marginBottom: '4px',
                  }}
                >
                  Secret Value
                </label>
                <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                  <input
                    type="password"
                    className="chat-input"
                    style={{ width: '100%', paddingRight: '36px' }}
                    placeholder="Enter secret (stored strictly in Windows Credential Manager)"
                    value={newSecretValue}
                    onChange={(e) => setNewSecretValue(e.target.value)}
                  />
                  <Lock
                    size={16}
                    style={{ position: 'absolute', right: '12px', color: '#8b949e' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn btn-primary" onClick={handleAddSecret}>
                  Save to Keyring
                </button>
                <button type="button" className="btn" onClick={() => setShowAddSecret(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Keyring Reference ID</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {credentials.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{ textAlign: 'center', color: '#8b949e', padding: '16px' }}
                  >
                    No keyring secrets registered.
                  </td>
                </tr>
              ) : (
                credentials.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.label}</td>
                    <td>
                      <span
                        style={{
                          backgroundColor: '#21262d',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          color: '#58a6ff',
                        }}
                      >
                        {c.type}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8b949e' }}>
                      {c.id}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '4px 8px', color: '#f85149' }}
                        onClick={() => handleDeleteSecret(c.id)}
                        title="Delete Secret from Keyring"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="panel-card" style={{ backgroundColor: '#161b22', borderColor: '#30363d' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#3fb950',
              marginBottom: '8px',
            }}
          >
            <ShieldCheck size={18} />
            <h4 style={{ margin: 0 }}>Security Baseline Invariants</h4>
          </div>
          <ul
            style={{ paddingLeft: '20px', color: '#8b949e', fontSize: '13px', lineHeight: '1.8' }}
          >
            <li>Zero mandatory cloud relays; local-first direct server connections.</li>
            <li>Policy Engine runs outside model context in native Rust runtime.</li>
            <li>Full audit event immutability recorded to local SQLite.</li>
            <li>Zero plaintext secrets stored in database or serialized into AI prompts.</li>
          </ul>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Save size={16} /> Save Settings
          </button>
          {savedStatus && (
            <span style={{ color: '#3fb950', fontSize: '13px', fontWeight: 500 }}>
              ✓ Settings saved to SQLite successfully
            </span>
          )}
        </div>
      </form>
    </div>
  );
};
