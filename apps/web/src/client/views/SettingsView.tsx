import React, { useEffect, useState } from 'react';
import { Save, CheckCircle2, AlertCircle, Key, Server, Folder, Sparkles, Terminal, Copy, Check, Shield } from 'lucide-react';
import { apiRequest } from '../api.js';

export const SettingsView: React.FC = () => {
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-5-mini');
  const [whmHost, setWhmHost] = useState('127.0.0.1');
  const [whmPort, setWhmPort] = useState(2087);
  const [whmToken, setWhmToken] = useState('');
  const [websiteRoot, setWebsiteRoot] = useState('');
  const [hasWhmToken, setHasWhmToken] = useState(false);
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState('127.0.0.1');
  const [sshPort, setSshPort] = useState(22);
  const [sshUsername, setSshUsername] = useState('root');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [sshPassphrase, setSshPassphrase] = useState('');
  const [hasSshKey, setHasSshKey] = useState(false);
  const [testingSsh, setTestingSsh] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingWhm, setTestingWhm] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadSettings = async () => {
    try {
      const res = await apiRequest('/api/settings');
      const data = res.data || {};
      setWhmHost(data.whmHost || '127.0.0.1');
      setWhmPort(data.whmPort || 2087);
      setOpenaiModel(data.openaiModel || 'gpt-5-mini');
      setWebsiteRoot(data.websiteRoot || '');
      setHasWhmToken(data.hasWhmToken || false);
      setHasOpenaiKey(data.hasOpenaiKey || false);
      setSshEnabled(data.sshEnabled || false);
      setSshHost(data.sshHost || '127.0.0.1');
      setSshPort(data.sshPort || 22);
      setSshUsername(data.sshUsername || 'root');
      setHasSshKey(data.hasSshKey || false);
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Failed to load settings', type: 'error' });
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);
    try {
      const body: any = {
        whmHost,
        whmPort,
        openaiModel,
        websiteRoot,
        sshEnabled,
        sshHost,
        sshPort,
        sshUsername,
      };
      if (openaiKey) body.openaiApiKey = openaiKey;
      if (whmToken) body.whmToken = whmToken;
      if (sshPrivateKey) body.sshPrivateKey = sshPrivateKey;
      if (sshPassphrase) body.sshPassphrase = sshPassphrase;

      await apiRequest('/api/settings', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      setStatusMessage({ text: 'Configuration saved successfully', type: 'success' });
      setOpenaiKey('');
      setWhmToken('');
      setSshPrivateKey('');
      setSshPassphrase('');
      loadSettings();
      window.dispatchEvent(new Event('rc-settings-updated'));
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Failed to save settings', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const testAi = async () => {
    setTestingAi(true);
    setStatusMessage(null);
    try {
      const res = await apiRequest('/api/ai/status');
      if (res.data?.success) {
        setStatusMessage({ text: res.data.message || 'OpenAI API key verified successfully!', type: 'success' });
      } else {
        setStatusMessage({ text: res.data?.message || 'OpenAI verification failed', type: 'error' });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Error testing OpenAI connection', type: 'error' });
    } finally {
      setTestingAi(false);
    }
  };

  const testWhm = async () => {
    setTestingWhm(true);
    setStatusMessage(null);
    try {
      const res = await apiRequest('/api/whm/status');
      if (res.data?.connected) {
        setStatusMessage({ text: `WHM connection verified: Version ${res.data.version}`, type: 'success' });
        window.dispatchEvent(new Event('rc-settings-updated'));
      } else {
        setStatusMessage({ text: res.data?.error || 'WHM connection failed', type: 'error' });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Error testing WHM', type: 'error' });
    } finally {
      setTestingWhm(false);
    }
  };

  const testSsh = async () => {
    setTestingSsh(true);
    setStatusMessage(null);
    try {
      const res = await apiRequest('/api/settings/test-ssh', {
        method: 'POST',
        body: JSON.stringify({
          host: sshHost,
          port: sshPort,
          username: sshUsername,
          privateKey: sshPrivateKey || undefined,
          passphrase: sshPassphrase || undefined,
        }),
      });
      if (res.success) {
        setStatusMessage({ text: res.message || 'SSH connection verified successfully!', type: 'success' });
        loadSettings();
        window.dispatchEvent(new Event('rc-settings-updated'));
      } else {
        setStatusMessage({ text: res.message || 'SSH connection failed', type: 'error' });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Error testing SSH connection', type: 'error' });
    } finally {
      setTestingSsh(false);
    }
  };

  const generateKey = async () => {
    setGeneratingKey(true);
    setStatusMessage(null);
    try {
      const res = await apiRequest('/api/settings/generate-ssh-key', { method: 'POST' });
      if (res.success) {
        setGeneratedPublicKey(res.publicKey);
        setSshPrivateKey(res.privateKey);
        setStatusMessage({
          text: 'New SSH key pair generated! Copy the public key below and authorize it in WHM or cPanel.',
          type: 'success',
        });
      } else {
        setStatusMessage({ text: res.error || 'Failed to generate key pair', type: 'error' });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Failed to generate SSH key pair', type: 'error' });
    } finally {
      setGeneratingKey(false);
    }
  };

  const copyPublicKey = () => {
    if (generatedPublicKey) {
      navigator.clipboard.writeText(generatedPublicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="view-container">
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Web Agent Configuration</h2>
        <p style={{ fontSize: '13px', color: '#8b949e', marginTop: '4px' }}>
          Configure AI provider keys, loopback WHM token, and local website root paths.
        </p>
      </div>

      {statusMessage && (
        <div
          className="card"
          style={{
            borderLeft: statusMessage.type === 'success' ? '4px solid #238636' : '4px solid #da3633',
            backgroundColor: statusMessage.type === 'success' ? 'rgba(35, 134, 54, 0.1)' : 'rgba(218, 54, 51, 0.1)',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: statusMessage.type === 'success' ? '#3fb950' : '#f85149',
          }}
        >
          {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* AI Provider Section */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={18} color="#bc8cff" />
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>AI Provider (OpenAI)</h3>
              {hasOpenaiKey && <span className="badge badge-success">API Key Active</span>}
            </div>

            <button
              type="button"
              className="btn"
              onClick={testAi}
              disabled={testingAi}
            >
              {testingAi ? 'Testing OpenAI...' : 'Test Connection'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                OpenAI API Key
              </label>
              <input
                type="password"
                className="input-field"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder={hasOpenaiKey ? '•••••••••••••••••••••••••••• (Leave blank to keep existing)' : 'sk-proj-...'}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                Model Identifier
              </label>
              <input
                type="text"
                className="input-field"
                value={openaiModel}
                onChange={(e) => setOpenaiModel(e.target.value)}
                placeholder="gpt-5-mini"
              />
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                {['gpt-5-mini', 'o3-mini', 'gpt-4o', 'gpt-4o-mini'].map((m) => (
                  <button
                    type="button"
                    key={m}
                    className="btn"
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      background: openaiModel === m ? '#238636' : '#21262d',
                      borderColor: openaiModel === m ? '#2ea043' : '#30363d',
                    }}
                    onClick={() => setOpenaiModel(m)}
                  >
                    {m === 'gpt-5-mini' ? `${m} (Recommended)` : m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* WHM API Token Section */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Server size={18} color="#58a6ff" />
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>cPanel & WHM API 1 Token</h3>
              {hasWhmToken && <span className="badge badge-success">Token Active</span>}
            </div>

            <button
              type="button"
              className="btn"
              onClick={testWhm}
              disabled={testingWhm}
            >
              {testingWhm ? 'Testing Gateway...' : 'Test Connection'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                WHM Host / Server Domain
              </label>
              <input
                type="text"
                className="input-field"
                value={whmHost}
                onChange={(e) => setWhmHost(e.target.value)}
                placeholder="127.0.0.1 or server.yourdomain.com"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                WHM Port
              </label>
              <input
                type="number"
                className="input-field"
                value={whmPort}
                onChange={(e) => setWhmPort(Number.parseInt(e.target.value, 10) || 2087)}
                placeholder="2087"
              />
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
              WHM API 1 Token String
            </label>
            <input
              type="password"
              className="input-field"
              value={whmToken}
              onChange={(e) => setWhmToken(e.target.value)}
              placeholder={hasWhmToken ? '•••••••••••••••••••••••••••• (Leave blank to keep existing)' : 'Paste 32/64-character token from WHM Manage API Tokens'}
            />
          </div>
          <p style={{ fontSize: '12px', color: '#8b949e' }}>
            For local testing from your PC, enter your server domain (e.g. <code>server.yourdomain.com</code>). On the production cPanel server, you can use <code>127.0.0.1</code> or your server domain.
          </p>
        </div>

        {/* Local Server SSH Execution Section */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={18} color="#3fb950" />
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Local Server SSH Execution (Root / Sudo)</h3>
              {sshEnabled && hasSshKey && <span className="badge badge-success">SSH Ready</span>}
              {sshEnabled && !hasSshKey && <span className="badge badge-warning">Key Required</span>}
              {!sshEnabled && <span className="badge" style={{ backgroundColor: 'rgba(139, 148, 158, 0.2)', color: '#8b949e', border: '1px solid rgba(139, 148, 158, 0.3)' }}>Disabled</span>}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn"
                onClick={generateKey}
                disabled={generatingKey}
              >
                <Key size={14} />
                {generatingKey ? 'Generating...' : 'Generate Key Pair'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={testSsh}
                disabled={testingSsh || (!hasSshKey && !sshPrivateKey)}
              >
                {testingSsh ? 'Testing SSH...' : 'Test Connection'}
              </button>
            </div>
          </div>

          <p style={{ fontSize: '13px', color: '#8b949e', marginBottom: '16px' }}>
            Allows the AI agent to execute system diagnostics, check Apache/Passenger vhosts, and run shell/sudo commands on this server via local SSH (loopback <code>127.0.0.1</code>).
          </p>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={sshEnabled}
                onChange={(e) => setSshEnabled(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#238636' }}
              />
              Enable Local SSH Command Execution
            </label>
          </div>

          {sshEnabled && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                    SSH Host
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={sshHost}
                    onChange={(e) => setSshHost(e.target.value)}
                    placeholder="127.0.0.1"
                  />
                  <span style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginTop: '4px' }}>Typically 127.0.0.1 for local server</span>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                    SSH Port
                  </label>
                  <input
                    type="number"
                    className="input-field"
                    value={sshPort}
                    onChange={(e) => setSshPort(Number.parseInt(e.target.value, 10) || 22)}
                    placeholder="22"
                  />
                  <span style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginTop: '4px' }}>Default 22 (or custom SSH port)</span>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                    SSH User
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={sshUsername}
                    onChange={(e) => setSshUsername(e.target.value)}
                    placeholder="root or cpaneluser"
                  />
                  <span style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginTop: '4px' }}><code>root</code> or cPanel user with <code>sudo</code></span>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  SSH Private Key (OpenSSH Format)
                </label>
                <textarea
                  className="input-field"
                  rows={4}
                  style={{ fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                  value={sshPrivateKey}
                  onChange={(e) => setSshPrivateKey(e.target.value)}
                  placeholder={hasSshKey ? '•••••••••••••••••••••••••••• (Encrypted key saved on server. Paste new key to replace)' : '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  Key Passphrase (optional)
                </label>
                <input
                  type="password"
                  className="input-field"
                  value={sshPassphrase}
                  onChange={(e) => setSshPassphrase(e.target.value)}
                  placeholder="Leave blank if private key has no passphrase"
                />
              </div>

              {generatedPublicKey && (
                <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '6px', padding: '14px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#58a6ff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Key size={14} /> Generated Public Key (Authorize in WHM / cPanel)
                    </span>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                      onClick={copyPublicKey}
                    >
                      {copiedKey ? <Check size={12} color="#3fb950" /> : <Copy size={12} />}
                      {copiedKey ? 'Copied!' : 'Copy Public Key'}
                    </button>
                  </div>
                  <pre style={{
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '4px',
                    padding: '8px',
                    fontSize: '11px',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                    color: '#c9d1d9',
                    fontFamily: 'monospace',
                    userSelect: 'all',
                  }}>
                    {generatedPublicKey}
                  </pre>
                  <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '8px', lineHeight: '1.5' }}>
                    <strong>Authorization options:</strong>
                    <ul style={{ paddingLeft: '18px', marginTop: '4px' }}>
                      <li><strong>Direct Root SSH:</strong> In WHM &rarr; <em>Security Center</em> &rarr; <em>Manage root&apos;s SSH Keys</em> &rarr; <em>Import Key</em> (paste this key) &rarr; click <em>Manage Authorization</em> &rarr; <em>Authorize</em>.</li>
                      <li><strong>cPanel User with Sudo:</strong> In cPanel &rarr; <em>SSH Access</em> &rarr; <em>Manage SSH Keys</em> &rarr; <em>Import Key</em> &rarr; <em>Authorize</em>. Add user to Wheel Group in WHM or configure <code>/etc/sudoers.d/</code>.</li>
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Website Root Section */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Folder size={18} color="#d29922" />
            <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Website Root Directory</h3>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
              Local Filesystem Root Path
            </label>
            <input
              type="text"
              className="input-field"
              value={websiteRoot}
              onChange={(e) => setWebsiteRoot(e.target.value)}
              placeholder="/home/username/public_html"
            />
            <p style={{ fontSize: '12px', color: '#8b949e', marginTop: '6px' }}>
              All file management operations in the Website Files tab and AI file tools will be safely scoped to this directory.
            </p>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving}
          style={{ padding: '8px 20px', fontSize: '14px' }}
        >
          <Save size={15} />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
};
