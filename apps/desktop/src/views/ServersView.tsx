import React, { useState } from 'react';
import {
  ServerProfile,
  ServerEnvironment,
  ConnectionTestResult,
  DiscoveredSshHost,
  ServerSystemInfo,
  ServerCpuUsage,
  ServerMemoryUsage,
  ServerDiskUsageEntry,
  ServerLoadAverage,
  ServerServiceInfo,
  ServerTailLogResult,
  ServiceAction,
  CpanelServerInfo,
  CpanelAccount,
  CpanelAccountDetail,
  CpanelDomainEntry,
  CpanelServiceStatus,
  CpanelSslStatus,
  CpanelBackupStatus,
  CpanelPhpVersionInfo,
  ServerTargetSelector,
  NodeExecutionResult,
  MultiServerAggregateResult,
  DiagnosticType,
  DiagnosticsMatrixRow,
  MultiServerDiagnosticsMatrixResult,
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
  Activity,
  Cpu,
  HardDrive,
  RotateCw,
  Play,
  Square,
  X,
  Terminal,
  CheckCircle2,
  Layers,
  Server,
  Filter,
} from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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

  // Diagnostics Modal State (Milestone M10)
  const [diagServer, setDiagServer] = useState<ServerProfile | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [sysInfo, setSysInfo] = useState<ServerSystemInfo | null>(null);
  const [cpuUsage, setCpuUsage] = useState<ServerCpuUsage | null>(null);
  const [memUsage, setMemUsage] = useState<ServerMemoryUsage | null>(null);
  const [diskUsage, setDiskUsage] = useState<ServerDiskUsageEntry[]>([]);
  const [loadAvg, setLoadAvg] = useState<ServerLoadAverage | null>(null);
  const [services, setServices] = useState<ServerServiceInfo[]>([]);
  const [tailLog, setTailLog] = useState<ServerTailLogResult | null>(null);
  const [serviceActionLoading, setServiceActionLoading] = useState<string | null>(null);

  const loadDiagnostics = async (srv: ServerProfile) => {
    setDiagLoading(true);
    setDiagError(null);
    try {
      const [sys, cpu, mem, disks, load, log] = await Promise.all([
        Bridge.serverSystemInfo(srv.id),
        Bridge.serverCpuUsage(srv.id),
        Bridge.serverMemoryUsage(srv.id),
        Bridge.serverDiskUsage(srv.id),
        Bridge.serverLoadAverage(srv.id),
        Bridge.serverTailLog(srv.id, '/var/log/messages', 15),
      ]);
      setSysInfo(sys);
      setCpuUsage(cpu);
      setMemUsage(mem);
      setDiskUsage(disks);
      setLoadAvg(load);
      setTailLog(log);

      const targetServices = ['httpd', 'mariadb', 'sshd', 'crond', 'firewalld'];
      const svcResults = await Promise.all(
        targetServices.map((svc) => Bridge.serverServiceStatus(srv.id, svc)),
      );
      setServices(svcResults);
    } catch (err: unknown) {
      setDiagError((err as Error)?.message ?? 'Failed to load diagnostics');
    } finally {
      setDiagLoading(false);
    }
  };

  const handleOpenDiagnostics = (srv: ServerProfile) => {
    setDiagServer(srv);
    loadDiagnostics(srv);
  };

  const handleServiceAction = async (serviceName: string, action: ServiceAction) => {
    if (!diagServer) return;
    setServiceActionLoading(`${serviceName}-${action}`);
    try {
      await Bridge.serverServiceAction(diagServer.id, serviceName, action);
      const updated = await Bridge.serverServiceStatus(diagServer.id, serviceName);
      setServices((prev) => prev.map((s) => (s.name === serviceName ? updated : s)));
    } catch (err: unknown) {
      alert(`Service action failed: ${(err as Error)?.message}`);
    } finally {
      setServiceActionLoading(null);
    }
  };

  // cPanel Modal State (Milestone M11)
  const [cpanelServer, setCpanelServer] = useState<ServerProfile | null>(null);
  const [cpanelLoading, setCpanelLoading] = useState(false);
  const [cpanelError, setCpanelError] = useState<string | null>(null);
  const [cpanelTab, setCpanelTab] = useState<
    'overview' | 'accounts' | 'domains' | 'services' | 'system'
  >('overview');
  const [cpanelServerInfo, setCpanelServerInfo] = useState<CpanelServerInfo | null>(null);
  const [cpanelAccounts, setCpanelAccounts] = useState<CpanelAccount[]>([]);
  const [cpanelDomains, setCpanelDomains] = useState<CpanelDomainEntry[]>([]);
  const [cpanelServices, setCpanelServices] = useState<CpanelServiceStatus[]>([]);
  const [cpanelSslList, setCpanelSslList] = useState<CpanelSslStatus[]>([]);
  const [cpanelBackup, setCpanelBackup] = useState<CpanelBackupStatus | null>(null);
  const [cpanelPhp, setCpanelPhp] = useState<CpanelPhpVersionInfo | null>(null);
  const [accountFilter, setAccountFilter] = useState('');
  const [selectedAccountDetail, setSelectedAccountDetail] = useState<CpanelAccountDetail | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<CpanelAccount | null>(null);
  const [suspendReason, setSuspendReason] = useState(
    'Administrative suspension requested by operator',
  );
  const [typedUsername, setTypedUsername] = useState('');
  const [cpanelActionLoading, setCpanelActionLoading] = useState<string | null>(null);

  const loadCpanelData = async (srv: ServerProfile) => {
    setCpanelLoading(true);
    setCpanelError(null);
    try {
      const [info, accounts, domains, svcs, ssl, backup, php] = await Promise.all([
        Bridge.cpanelServerInfo(srv.id),
        Bridge.cpanelListAccounts(srv.id),
        Bridge.cpanelListDomains(srv.id),
        Bridge.cpanelServiceStatus(srv.id),
        Bridge.cpanelSslStatus(srv.id),
        Bridge.cpanelBackupStatus(srv.id),
        Bridge.cpanelListPhpVersions(srv.id),
      ]);
      setCpanelServerInfo(info);
      setCpanelAccounts(accounts);
      setCpanelDomains(domains);
      setCpanelServices(svcs);
      setCpanelSslList(ssl);
      setCpanelBackup(backup);
      setCpanelPhp(php);
    } catch (err: unknown) {
      setCpanelError((err as Error)?.message ?? 'Failed to load cPanel data');
    } finally {
      setCpanelLoading(false);
    }
  };

  const handleOpenCpanel = (srv: ServerProfile) => {
    setCpanelServer(srv);
    setCpanelTab('overview');
    setSelectedAccountDetail(null);
    setActionNotice(null);
    loadCpanelData(srv);
  };

  const handleSelectAccount = async (user: string) => {
    if (!cpanelServer) return;
    setDetailLoading(true);
    try {
      const detail = await Bridge.cpanelAccountInfo(cpanelServer.id, user);
      setSelectedAccountDetail(detail);
    } catch (err: unknown) {
      alert(`Failed to load account detail: ${(err as Error)?.message}`);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleConfirmSuspend = async () => {
    if (!cpanelServer || !suspendTarget) return;
    if (typedUsername.trim() !== suspendTarget.user) {
      alert(`Confirmation mismatch: Please type '${suspendTarget.user}' to confirm.`);
      return;
    }
    setCpanelActionLoading(`suspend-${suspendTarget.user}`);
    try {
      const res = await Bridge.cpanelSuspendAccount(
        cpanelServer.id,
        suspendTarget.user,
        suspendReason,
      );
      setActionNotice({ type: 'success', message: res.message });
      setCpanelAccounts((prev) =>
        prev.map((a) =>
          a.user === suspendTarget.user
            ? { ...a, suspended: true, suspend_reason: suspendReason }
            : a,
        ),
      );
      setSuspendTarget(null);
      setTypedUsername('');
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: (err as Error)?.message ?? 'Failed to suspend account',
      });
    } finally {
      setCpanelActionLoading(null);
    }
  };

  const handleUnsuspendAccount = async (user: string) => {
    if (!cpanelServer) return;
    setCpanelActionLoading(`unsuspend-${user}`);
    try {
      const res = await Bridge.cpanelUnsuspendAccount(cpanelServer.id, user);
      setActionNotice({ type: 'success', message: res.message });
      setCpanelAccounts((prev) =>
        prev.map((a) =>
          a.user === user ? { ...a, suspended: false, suspend_reason: undefined } : a,
        ),
      );
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: (err as Error)?.message ?? 'Failed to unsuspend account',
      });
    } finally {
      setCpanelActionLoading(null);
    }
  };

  const handleRestartCpanelService = async (serviceName: string) => {
    if (!cpanelServer) return;
    setCpanelActionLoading(`restart-${serviceName}`);
    try {
      const res = await Bridge.cpanelRestartService(cpanelServer.id, serviceName);
      setActionNotice({ type: 'success', message: res.output });
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: (err as Error)?.message ?? 'Failed to restart service',
      });
    } finally {
      setCpanelActionLoading(null);
    }
  };

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

  // Multi-Server Batch Operations State (Milestone M12)
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchSelectorType, setBatchSelectorType] = useState<
    'selected' | 'all' | 'environment' | 'tag'
  >('selected');
  const [batchEnvFilter, setBatchEnvFilter] = useState<ServerEnvironment>('PRODUCTION');
  const [batchTagFilter, setBatchTagFilter] = useState<string>('');
  const [batchDiagType, setBatchDiagType] = useState<DiagnosticType>('system_info');
  const [batchServiceName, setBatchServiceName] = useState<string>('httpd');
  const [batchConcurrency, setBatchConcurrency] = useState<number>(5);
  const [batchTimeout, setBatchTimeout] = useState<number>(30);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [matrixResult, setMatrixResult] = useState<MultiServerDiagnosticsMatrixResult | null>(null);
  const [batchAggregateResult, setBatchAggregateResult] =
    useState<MultiServerAggregateResult | null>(null);
  const [batchFilterStatus, setBatchFilterStatus] = useState<'all' | 'success' | 'failed'>('all');
  const [customToolName, setCustomToolName] = useState<string>('server.system_info');
  const [customToolArgs, setCustomToolArgs] = useState<string>('{}');
  const [batchConfirmationCode, setBatchConfirmationCode] = useState<string>('');
  const [typedBatchConfirmation, setTypedBatchConfirmation] = useState<string>('');

  const allTags = Array.from(new Set(servers.flatMap((s) => s.tags || []))).filter(Boolean);

  const toggleSelectServer = (id: string) => {
    setSelectedServerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleSelectAllServers = () => {
    if (selectedServerIds.length === servers.length) {
      setSelectedServerIds([]);
    } else {
      setSelectedServerIds(servers.map((s) => s.id));
    }
  };

  const getActiveSelector = (): ServerTargetSelector => {
    if (batchSelectorType === 'selected') {
      const ids = selectedServerIds.length > 0 ? selectedServerIds : servers.map((s) => s.id);
      return { type: 'server_ids', serverIds: ids };
    }
    if (batchSelectorType === 'all') {
      return { type: 'all' };
    }
    if (batchSelectorType === 'environment') {
      return { type: 'environment', environment: batchEnvFilter };
    }
    if (batchSelectorType === 'tag') {
      return { type: 'tag', tag: batchTagFilter || (allTags[0] ?? 'web') };
    }
    return { type: 'all' };
  };

  const getResolvedTargetServers = (): ServerProfile[] => {
    const sel = getActiveSelector();
    switch (sel.type) {
      case 'all':
        return servers;
      case 'environment':
        return servers.filter((s) => s.environment.toLowerCase() === sel.environment.toLowerCase());
      case 'tag':
        return servers.filter((s) => s.tags.some((t) => t.toLowerCase() === sel.tag.toLowerCase()));
      case 'tags':
        return servers.filter((s) => sel.tags.some((t: string) => s.tags.includes(t)));
      case 'server_ids':
        return servers.filter((s) => sel.serverIds.includes(s.id));
      default:
        return servers;
    }
  };

  const resolvedTargets = getResolvedTargetServers();
  const hasProductionTarget = resolvedTargets.some((s) => s.environment === 'PRODUCTION');

  const handleRunBatchDiagnostics = async (type: DiagnosticType) => {
    setBatchDiagType(type);
    setBatchLoading(true);
    setBatchError(null);
    setBatchAggregateResult(null);
    try {
      const selector = getActiveSelector();
      const res = await Bridge.multiServerDiagnosticsMatrix({
        selector,
        diagnosticType: type,
        serviceName: type === 'service_status' ? batchServiceName : undefined,
        concurrencyLimit: batchConcurrency,
        timeoutSeconds: batchTimeout,
      });
      setMatrixResult(res);
    } catch (err: unknown) {
      setBatchError((err as Error)?.message ?? 'Batch diagnostics failed');
    } finally {
      setBatchLoading(false);
    }
  };

  const handleRunBatchTool = async () => {
    setBatchLoading(true);
    setBatchError(null);
    setMatrixResult(null);
    try {
      const selector = getActiveSelector();
      const policy = await Bridge.multiServerEvaluatePolicy(
        `batch-${Date.now()}`,
        customToolName,
        selector,
        customToolName.startsWith('server.service_') ? 'HIGH' : 'MEDIUM',
      );

      if (policy.requiresConfirmation && policy.confirmationCode) {
        if (typedBatchConfirmation !== policy.confirmationCode) {
          setBatchConfirmationCode(policy.confirmationCode);
          setBatchError(
            `State-modifying batch requires typed confirmation code: '${policy.confirmationCode}'`,
          );
          setBatchLoading(false);
          return;
        }
      }

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(customToolArgs || '{}');
      } catch {
        parsedArgs = {};
      }

      const res = await Bridge.multiServerExecuteBatch({
        batchId: `batch-${Date.now()}`,
        toolName: customToolName,
        arguments: parsedArgs,
        selector,
        concurrencyLimit: batchConcurrency,
        timeoutSeconds: batchTimeout,
      });
      setBatchAggregateResult(res);
      setBatchConfirmationCode('');
      setTypedBatchConfirmation('');
    } catch (err: unknown) {
      setBatchError((err as Error)?.message ?? 'Batch execution failed');
    } finally {
      setBatchLoading(false);
    }
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
          <button
            className="btn"
            style={{
              backgroundColor: '#1f6feb',
              color: '#ffffff',
              border: '1px solid #388bfd',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onClick={() => setShowBatchModal(true)}
          >
            <Layers size={15} />
            Multi-Server Console (
            {selectedServerIds.length > 0 ? `${selectedServerIds.length} Selected` : 'All'})
          </button>
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
              <th style={{ width: '40px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={servers.length > 0 && selectedServerIds.length === servers.length}
                  onChange={toggleSelectAllServers}
                  title="Select / deselect all servers"
                />
              </th>
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
              const isSelected = selectedServerIds.includes(s.id);
              return (
                <tr
                  key={s.id}
                  style={{
                    backgroundColor: isSelected ? '#1f6feb15' : undefined,
                  }}
                >
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectServer(s.id)}
                      title={`Select ${s.name}`}
                    />
                  </td>
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
                      onClick={() => handleOpenDiagnostics(s)}
                      title="Server Health & Diagnostics (M10)"
                    >
                      <Activity size={13} color="#58a6ff" /> Health
                    </button>
                    {s.cpanelEnabled && (
                      <button
                        className="btn"
                        style={{
                          padding: '4px 8px',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          borderColor: '#8957e5',
                          color: '#d2a8ff',
                        }}
                        onClick={() => handleOpenCpanel(s)}
                        title="WHM/cPanel Management (M11)"
                      >
                        <Globe size={13} color="#d2a8ff" /> cPanel
                      </button>
                    )}
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

      {/* Milestone M10: Server Health & Diagnostics Modal */}
      {diagServer && (
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
              maxWidth: '900px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #21262d',
                paddingBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Activity size={24} color="#58a6ff" />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, color: '#f0f6fc' }}>{diagServer.name}</h3>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor:
                          diagServer.environment === 'PRODUCTION' ? '#da363326' : '#23863626',
                        color: diagServer.environment === 'PRODUCTION' ? '#f85149' : '#3fb950',
                        border:
                          diagServer.environment === 'PRODUCTION'
                            ? '1px solid #da363366'
                            : '1px solid #23863666',
                      }}
                    >
                      {diagServer.environment}
                    </span>
                  </div>
                  <div style={{ color: '#8b949e', fontSize: '12px' }}>
                    {diagServer.hostname}:{diagServer.port} &bull; User: {diagServer.username}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className="btn"
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  onClick={() => loadDiagnostics(diagServer)}
                  disabled={diagLoading}
                >
                  <RefreshCw size={13} className={diagLoading ? 'spin' : ''} /> Refresh
                </button>
                <button
                  className="btn"
                  style={{ padding: '4px 8px' }}
                  onClick={() => setDiagServer(null)}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {diagLoading && !sysInfo && (
              <div style={{ padding: '32px', textAlign: 'center', color: '#8b949e' }}>
                <RefreshCw size={24} className="spin" style={{ marginBottom: '8px' }} />
                <div>Collecting real-time server telemetry...</div>
              </div>
            )}

            {diagError && (
              <div
                style={{
                  backgroundColor: '#da363326',
                  color: '#f85149',
                  padding: '12px',
                  borderRadius: '6px',
                  border: '1px solid #da363366',
                  fontSize: '13px',
                }}
              >
                {diagError}
              </div>
            )}

            {sysInfo && (
              <>
                {/* System & Hardware Overview Cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: '#0d1117',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #21262d',
                    }}
                  >
                    <div style={{ color: '#8b949e', fontSize: '11px', textTransform: 'uppercase' }}>
                      OS & Distribution
                    </div>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#f0f6fc',
                        marginTop: '4px',
                      }}
                    >
                      {sysInfo.os_name} {sysInfo.os_version}
                    </div>
                    <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                      Kernel: {sysInfo.kernel} ({sysInfo.arch})
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#0d1117',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #21262d',
                    }}
                  >
                    <div style={{ color: '#8b949e', fontSize: '11px', textTransform: 'uppercase' }}>
                      System Uptime
                    </div>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#3fb950',
                        marginTop: '4px',
                      }}
                    >
                      {sysInfo.uptime_human}
                    </div>
                    <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                      Distro Family: {sysInfo.distro_family.toUpperCase()}
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#0d1117',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #21262d',
                    }}
                  >
                    <div
                      style={{
                        color: '#8b949e',
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Cpu size={12} color="#58a6ff" /> CPU ({cpuUsage?.cores ?? 1} Cores)
                    </div>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#f0f6fc',
                        marginTop: '4px',
                      }}
                    >
                      {cpuUsage ? `${(100 - cpuUsage.idle_pct).toFixed(1)}% Busy` : 'N/A'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                      {cpuUsage?.model_name || 'Generic CPU'}
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#0d1117',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #21262d',
                    }}
                  >
                    <div style={{ color: '#8b949e', fontSize: '11px', textTransform: 'uppercase' }}>
                      Load Average
                    </div>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#f0f6fc',
                        marginTop: '4px',
                      }}
                    >
                      {loadAvg
                        ? `${loadAvg.load_1m.toFixed(2)}, ${loadAvg.load_5m.toFixed(2)}, ${loadAvg.load_15m.toFixed(2)}`
                        : 'N/A'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                      1m, 5m, 15m normalized
                    </div>
                  </div>
                </div>

                {/* Memory Usage Bar */}
                {memUsage && (
                  <div
                    style={{
                      backgroundColor: '#0d1117',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #21262d',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                        marginBottom: '6px',
                      }}
                    >
                      <span style={{ color: '#8b949e' }}>Memory Utilization (RAM)</span>
                      <span style={{ color: '#f0f6fc', fontWeight: 600 }}>
                        {formatBytes(memUsage.used_bytes)} / {formatBytes(memUsage.total_bytes)} (
                        {((memUsage.used_bytes / memUsage.total_bytes) * 100).toFixed(1)}%)
                      </span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: '8px',
                        backgroundColor: '#21262d',
                        borderRadius: '4px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, (memUsage.used_bytes / memUsage.total_bytes) * 100)}%`,
                          height: '100%',
                          backgroundColor:
                            memUsage.used_bytes / memUsage.total_bytes > 0.85
                              ? '#da3633'
                              : '#238636',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        color: '#8b949e',
                        marginTop: '6px',
                      }}
                    >
                      <span>Free: {formatBytes(memUsage.free_bytes)}</span>
                      <span>Buffer/Cache: {formatBytes(memUsage.buff_cache_bytes)}</span>
                      <span>Available: {formatBytes(memUsage.available_bytes)}</span>
                      <span>
                        Swap: {formatBytes(memUsage.swap_used_bytes)} /{' '}
                        {formatBytes(memUsage.swap_total_bytes)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Disk Partitions */}
                {diskUsage.length > 0 && (
                  <div
                    style={{
                      backgroundColor: '#0d1117',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #21262d',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#f0f6fc',
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <HardDrive size={15} color="#58a6ff" /> Disk Partitions & Storage Mounts
                    </div>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '12px',
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            color: '#8b949e',
                            textAlign: 'left',
                            borderBottom: '1px solid #21262d',
                          }}
                        >
                          <th style={{ padding: '6px' }}>Filesystem</th>
                          <th style={{ padding: '6px' }}>Mount</th>
                          <th style={{ padding: '6px' }}>Used / Size</th>
                          <th style={{ padding: '6px' }}>Available</th>
                          <th style={{ padding: '6px', width: '140px' }}>Usage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diskUsage.map((d, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #161b22' }}>
                            <td style={{ padding: '6px', fontFamily: 'monospace' }}>
                              {d.filesystem}
                            </td>
                            <td style={{ padding: '6px', fontWeight: 600, color: '#58a6ff' }}>
                              {d.mount_point}
                            </td>
                            <td style={{ padding: '6px' }}>
                              {formatBytes(d.used_bytes)} / {formatBytes(d.total_bytes)}
                            </td>
                            <td style={{ padding: '6px', color: '#8b949e' }}>
                              {formatBytes(d.available_bytes)}
                            </td>
                            <td style={{ padding: '6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div
                                  style={{
                                    flex: 1,
                                    height: '6px',
                                    backgroundColor: '#21262d',
                                    borderRadius: '3px',
                                    overflow: 'hidden',
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${Math.min(100, d.use_percentage)}%`,
                                      height: '100%',
                                      backgroundColor:
                                        d.use_percentage > 85 ? '#da3633' : '#238636',
                                    }}
                                  />
                                </div>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    width: '32px',
                                    textAlign: 'right',
                                  }}
                                >
                                  {d.use_percentage.toFixed(0)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Managed System Services */}
                <div
                  style={{
                    backgroundColor: '#0d1117',
                    padding: '12px',
                    borderRadius: '6px',
                    border: '1px solid #21262d',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#f0f6fc',
                      marginBottom: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <RotateCw size={15} color="#58a6ff" /> Linux Services Status & Control
                  </div>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '12px',
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          color: '#8b949e',
                          textAlign: 'left',
                          borderBottom: '1px solid #21262d',
                        }}
                      >
                        <th style={{ padding: '6px' }}>Service Name</th>
                        <th style={{ padding: '6px' }}>Resolved Unit</th>
                        <th style={{ padding: '6px' }}>Status</th>
                        <th style={{ padding: '6px' }}>Main PID</th>
                        <th style={{ padding: '6px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map((svc) => {
                        const isLoading = serviceActionLoading?.startsWith(svc.name);
                        return (
                          <tr key={svc.name} style={{ borderBottom: '1px solid #161b22' }}>
                            <td style={{ padding: '6px', fontWeight: 600 }}>{svc.name}</td>
                            <td
                              style={{
                                padding: '6px',
                                fontFamily: 'monospace',
                                color: '#8b949e',
                              }}
                            >
                              {svc.resolved_name}
                            </td>
                            <td style={{ padding: '6px' }}>
                              <span
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  backgroundColor: svc.is_running ? '#23863626' : '#da363326',
                                  color: svc.is_running ? '#3fb950' : '#f85149',
                                  border: svc.is_running
                                    ? '1px solid #23863666'
                                    : '1px solid #da363366',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                {svc.is_running && <CheckCircle2 size={11} />}
                                {svc.active_state} ({svc.sub_state})
                              </span>
                            </td>
                            <td
                              style={{
                                padding: '6px',
                                fontFamily: 'monospace',
                                color: '#8b949e',
                              }}
                            >
                              {svc.main_pid ?? '—'}
                            </td>
                            <td style={{ padding: '6px', textAlign: 'right' }}>
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'flex-end',
                                  gap: '6px',
                                }}
                              >
                                <button
                                  className="btn"
                                  style={{ padding: '2px 6px', fontSize: '11px' }}
                                  disabled={Boolean(isLoading)}
                                  onClick={() => handleServiceAction(svc.name, 'restart')}
                                  title={`Restart ${svc.resolved_name}`}
                                >
                                  Restart
                                </button>
                                {svc.is_running ? (
                                  <button
                                    className="btn"
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: '11px',
                                      color: '#f85149',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                    disabled={Boolean(isLoading)}
                                    onClick={() => handleServiceAction(svc.name, 'stop')}
                                    title={`Stop ${svc.resolved_name}`}
                                  >
                                    <Square size={10} /> Stop
                                  </button>
                                ) : (
                                  <button
                                    className="btn"
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: '11px',
                                      color: '#3fb950',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                    disabled={Boolean(isLoading)}
                                    onClick={() => handleServiceAction(svc.name, 'start')}
                                    title={`Start ${svc.resolved_name}`}
                                  >
                                    <Play size={10} /> Start
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* System Log Tail */}
                {tailLog && tailLog.lines.length > 0 && (
                  <div
                    style={{
                      backgroundColor: '#0d1117',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #21262d',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#f0f6fc',
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Terminal size={15} color="#58a6ff" /> Recent System Messages ({tailLog.path})
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        backgroundColor: '#010409',
                        padding: '8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: '#c9d1d9',
                        maxHeight: '120px',
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {tailLog.lines.join('\n')}
                    </pre>
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button className="btn" onClick={() => setDiagServer(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WHM / cPanel Management Modal (Milestone M11) */}
      {cpanelServer && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
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
              maxWidth: '1050px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #21262d',
                paddingBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Globe size={26} color="#d2a8ff" />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, color: '#f0f6fc' }}>
                      {cpanelServer.name} &bull; WHM / cPanel Management
                    </h3>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: '#8957e526',
                        color: '#d2a8ff',
                        border: '1px solid #8957e566',
                      }}
                    >
                      WHM :{cpanelServer.whmPort ?? 2087}
                    </span>
                  </div>
                  <div style={{ color: '#8b949e', fontSize: '12px', marginTop: '2px' }}>
                    Target Host: {cpanelServer.hostname}:{cpanelServer.port} &bull; Environment:{' '}
                    {cpanelServer.environment}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className="btn"
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  onClick={() => loadCpanelData(cpanelServer)}
                  disabled={cpanelLoading}
                >
                  <RefreshCw size={13} className={cpanelLoading ? 'spin' : ''} /> Refresh
                </button>
                <button
                  className="btn"
                  style={{ padding: '4px 8px' }}
                  onClick={() => setCpanelServer(null)}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Action Notice Banner */}
            {actionNotice && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '6px',
                  backgroundColor:
                    actionNotice.type === 'success'
                      ? 'rgba(35, 134, 54, 0.2)'
                      : 'rgba(218, 54, 51, 0.2)',
                  border:
                    actionNotice.type === 'success' ? '1px solid #238636' : '1px solid #da3633',
                  color: actionNotice.type === 'success' ? '#3fb950' : '#f85149',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                }}
              >
                <span>{actionNotice.message}</span>
                <button
                  onClick={() => setActionNotice(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Navigation Tabs */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                borderBottom: '1px solid #21262d',
                paddingBottom: '8px',
              }}
            >
              {[
                { id: 'overview', label: 'Overview' },
                { id: 'accounts', label: `Accounts (${cpanelAccounts.length})` },
                { id: 'domains', label: `Domains & SSL (${cpanelDomains.length})` },
                { id: 'services', label: `Daemons & Services (${cpanelServices.length})` },
                { id: 'system', label: 'MultiPHP & Backup' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  className="btn"
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: cpanelTab === tab.id ? '#8957e526' : 'transparent',
                    color: cpanelTab === tab.id ? '#d2a8ff' : '#8b949e',
                    border: cpanelTab === tab.id ? '1px solid #8957e5' : '1px solid transparent',
                  }}
                  onClick={() =>
                    setCpanelTab(
                      tab.id as 'overview' | 'accounts' | 'domains' | 'services' | 'system',
                    )
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Main Content Body */}
            {cpanelLoading && !cpanelServerInfo ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  color: '#58a6ff',
                  padding: '40px',
                }}
              >
                <RefreshCw size={20} className="spin" /> Querying WHM API 1 / cPanel Services...
              </div>
            ) : cpanelError ? (
              <div
                style={{
                  backgroundColor: 'rgba(218, 54, 51, 0.15)',
                  border: '1px solid #da3633',
                  color: '#f85149',
                  padding: '16px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <strong>WHM/cPanel Query Failed:</strong> {cpanelError}
                </div>
                <button className="btn btn-danger" onClick={() => loadCpanelData(cpanelServer)}>
                  Retry
                </button>
              </div>
            ) : (
              <>
                {/* TAB 1: OVERVIEW */}
                {cpanelTab === 'overview' && cpanelServerInfo && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: '12px',
                      }}
                    >
                      <div
                        style={{
                          backgroundColor: '#0d1117',
                          padding: '12px',
                          borderRadius: '6px',
                          border: '1px solid #21262d',
                        }}
                      >
                        <div
                          style={{ color: '#8b949e', fontSize: '11px', textTransform: 'uppercase' }}
                        >
                          WHM / cPanel Version
                        </div>
                        <div
                          style={{
                            fontSize: '16px',
                            fontWeight: 600,
                            color: '#f0f6fc',
                            marginTop: '4px',
                          }}
                        >
                          v{cpanelServerInfo.version}
                        </div>
                        <div style={{ fontSize: '11px', color: '#58a6ff', marginTop: '2px' }}>
                          Tier: {cpanelServerInfo.cpanel_release_tier} (Build{' '}
                          {cpanelServerInfo.build})
                        </div>
                      </div>

                      <div
                        style={{
                          backgroundColor: '#0d1117',
                          padding: '12px',
                          borderRadius: '6px',
                          border: '1px solid #21262d',
                        }}
                      >
                        <div
                          style={{ color: '#8b949e', fontSize: '11px', textTransform: 'uppercase' }}
                        >
                          Operating System
                        </div>
                        <div
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: '#f0f6fc',
                            marginTop: '4px',
                          }}
                        >
                          {cpanelServerInfo.operating_system}
                        </div>
                        <div style={{ fontSize: '11px', color: '#3fb950', marginTop: '2px' }}>
                          License: {cpanelServerInfo.license_status}
                        </div>
                      </div>

                      <div
                        style={{
                          backgroundColor: '#0d1117',
                          padding: '12px',
                          borderRadius: '6px',
                          border: '1px solid #21262d',
                        }}
                      >
                        <div
                          style={{ color: '#8b949e', fontSize: '11px', textTransform: 'uppercase' }}
                        >
                          Active Daemons
                        </div>
                        <div
                          style={{
                            fontSize: '16px',
                            fontWeight: 600,
                            color: '#3fb950',
                            marginTop: '4px',
                          }}
                        >
                          {cpanelServerInfo.active_services_count} Monitored
                        </div>
                        <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>
                          cpsrvd, cpdavd, queueprocd, etc.
                        </div>
                      </div>

                      <div
                        style={{
                          backgroundColor: '#0d1117',
                          padding: '12px',
                          borderRadius: '6px',
                          border: '1px solid #21262d',
                        }}
                      >
                        <div
                          style={{ color: '#8b949e', fontSize: '11px', textTransform: 'uppercase' }}
                        >
                          Total Hosted Accounts
                        </div>
                        <div
                          style={{
                            fontSize: '16px',
                            fontWeight: 600,
                            color: '#f0f6fc',
                            marginTop: '4px',
                          }}
                        >
                          {cpanelAccounts.length} Accounts
                        </div>
                        <div style={{ fontSize: '11px', color: '#e3b341', marginTop: '2px' }}>
                          {cpanelAccounts.filter((a) => a.suspended).length} Suspended
                        </div>
                      </div>
                    </div>

                    {/* Quick System Summary Banner */}
                    <div
                      style={{
                        backgroundColor: '#0d1117',
                        padding: '14px',
                        borderRadius: '6px',
                        border: '1px solid #21262d',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '13px' }}>
                        System Status Summary
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '12px',
                          fontSize: '12px',
                        }}
                      >
                        <div>
                          <span style={{ color: '#8b949e' }}>Default MultiPHP:</span>{' '}
                          <code style={{ color: '#79c0ff' }}>
                            {cpanelPhp?.system_default ?? 'ea-php82'}
                          </code>
                        </div>
                        <div>
                          <span style={{ color: '#8b949e' }}>Backup Engine:</span>{' '}
                          <span
                            style={{ color: cpanelBackup?.backup_enabled ? '#3fb950' : '#f85149' }}
                          >
                            {cpanelBackup?.backup_enabled ? 'Enabled' : 'Disabled'}
                          </span>{' '}
                          ({cpanelBackup?.backup_type ?? 'compressed'})
                        </div>
                        <div>
                          <span style={{ color: '#8b949e' }}>Last Automated Backup:</span>{' '}
                          <span>{cpanelBackup?.last_run_status ?? 'Completed Successfully'}</span>
                        </div>
                        <div>
                          <span style={{ color: '#8b949e' }}>AutoSSL Active Domains:</span>{' '}
                          <span style={{ color: '#3fb950' }}>
                            {cpanelSslList.filter((s) => s.has_ssl).length} / {cpanelSslList.length}{' '}
                            Protected
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: ACCOUNTS */}
                {cpanelTab === 'accounts' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Filter Bar */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="chat-input"
                        placeholder="Filter accounts by username, domain, or email..."
                        value={accountFilter}
                        onChange={(e) => setAccountFilter(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: '12px', color: '#8b949e' }}>
                        Showing{' '}
                        {
                          cpanelAccounts.filter(
                            (a) =>
                              a.user.toLowerCase().includes(accountFilter.toLowerCase()) ||
                              a.domain.toLowerCase().includes(accountFilter.toLowerCase()) ||
                              a.email.toLowerCase().includes(accountFilter.toLowerCase()),
                          ).length
                        }{' '}
                        of {cpanelAccounts.length}
                      </span>
                    </div>

                    {/* Accounts Table */}
                    <div
                      style={{
                        overflowX: 'auto',
                        border: '1px solid #21262d',
                        borderRadius: '6px',
                      }}
                    >
                      <table className="data-table" style={{ width: '100%' }}>
                        <thead>
                          <tr>
                            <th>User / Owner</th>
                            <th>Domain</th>
                            <th>Plan</th>
                            <th>Disk Usage</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cpanelAccounts
                            .filter(
                              (a) =>
                                a.user.toLowerCase().includes(accountFilter.toLowerCase()) ||
                                a.domain.toLowerCase().includes(accountFilter.toLowerCase()) ||
                                a.email.toLowerCase().includes(accountFilter.toLowerCase()),
                            )
                            .map((acct) => (
                              <tr key={acct.user}>
                                <td>
                                  <div style={{ fontWeight: 600, color: '#f0f6fc' }}>
                                    {acct.user}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#8b949e' }}>
                                    owner: {acct.owner}
                                  </div>
                                </td>
                                <td>
                                  <div>{acct.domain}</div>
                                  <div style={{ fontSize: '11px', color: '#8b949e' }}>
                                    {acct.email}
                                  </div>
                                </td>
                                <td>
                                  <span style={{ fontSize: '12px', color: '#c9d1d9' }}>
                                    {acct.plan}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ fontSize: '12px' }}>
                                    {acct.disk_used} / {acct.disk_limit}
                                  </div>
                                  {acct.disk_limit_bytes > 0 && (
                                    <div
                                      style={{
                                        width: '100px',
                                        height: '5px',
                                        backgroundColor: '#21262d',
                                        borderRadius: '3px',
                                        overflow: 'hidden',
                                        marginTop: '4px',
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: `${Math.min(
                                            100,
                                            Math.round(
                                              (acct.disk_used_bytes / acct.disk_limit_bytes) * 100,
                                            ),
                                          )}%`,
                                          height: '100%',
                                          backgroundColor:
                                            acct.disk_used_bytes / acct.disk_limit_bytes > 0.9
                                              ? '#f85149'
                                              : '#3fb950',
                                        }}
                                      />
                                    </div>
                                  )}
                                </td>
                                <td>
                                  {acct.suspended ? (
                                    <span
                                      style={{
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        backgroundColor: '#da363326',
                                        color: '#f85149',
                                        border: '1px solid #da363366',
                                      }}
                                      title={acct.suspend_reason ?? 'Suspended'}
                                    >
                                      SUSPENDED
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        backgroundColor: '#23863626',
                                        color: '#3fb950',
                                        border: '1px solid #23863666',
                                      }}
                                    >
                                      ACTIVE
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button
                                      className="btn"
                                      style={{ padding: '3px 8px', fontSize: '11px' }}
                                      onClick={() => handleSelectAccount(acct.user)}
                                      disabled={detailLoading}
                                    >
                                      Details
                                    </button>
                                    {acct.suspended ? (
                                      <button
                                        className="btn"
                                        style={{
                                          padding: '3px 8px',
                                          fontSize: '11px',
                                          backgroundColor: '#23863626',
                                          color: '#3fb950',
                                          borderColor: '#238636',
                                        }}
                                        onClick={() => handleUnsuspendAccount(acct.user)}
                                        disabled={cpanelActionLoading === `unsuspend-${acct.user}`}
                                      >
                                        Unsuspend
                                      </button>
                                    ) : (
                                      <button
                                        className="btn btn-danger"
                                        style={{ padding: '3px 8px', fontSize: '11px' }}
                                        onClick={() => {
                                          setSuspendTarget(acct);
                                          setTypedUsername('');
                                        }}
                                      >
                                        Suspend
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Account Detail Drawer */}
                    {selectedAccountDetail && (
                      <div
                        style={{
                          backgroundColor: '#0d1117',
                          border: '1px solid #30363d',
                          borderRadius: '6px',
                          padding: '14px',
                          marginTop: '8px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '10px',
                          }}
                        >
                          <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '14px' }}>
                            Account Detail:{' '}
                            <code style={{ color: '#79c0ff' }}>{selectedAccountDetail.user}</code> (
                            {selectedAccountDetail.domain})
                          </div>
                          <button
                            className="btn"
                            style={{ padding: '2px 6px' }}
                            onClick={() => setSelectedAccountDetail(null)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: '8px',
                            fontSize: '12px',
                          }}
                        >
                          <div>
                            <span style={{ color: '#8b949e' }}>IP Address:</span>{' '}
                            <code>{selectedAccountDetail.ip}</code>
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>Theme:</span>{' '}
                            {selectedAccountDetail.theme}
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>MultiPHP:</span>{' '}
                            <code>{selectedAccountDetail.php_version ?? 'ea-php82'}</code>
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>Bandwidth:</span>{' '}
                            {formatBytes(selectedAccountDetail.bandwidth_used_bytes)} /{' '}
                            {formatBytes(selectedAccountDetail.bandwidth_limit_bytes)}
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>Databases:</span>{' '}
                            {selectedAccountDetail.max_sql} max
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>FTP Accounts:</span>{' '}
                            {selectedAccountDetail.max_ftp} max
                          </div>
                          {selectedAccountDetail.suspend_reason && (
                            <div style={{ gridColumn: '1 / -1', color: '#f85149' }}>
                              <span style={{ color: '#8b949e' }}>Suspend Reason:</span>{' '}
                              {selectedAccountDetail.suspend_reason} (at{' '}
                              {selectedAccountDetail.suspend_time ?? 'unknown'})
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Suspend Confirmation Sub-Modal (Strict Operator Confirmation) */}
                    {suspendTarget && (
                      <div
                        style={{
                          position: 'fixed',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: 'rgba(0,0,0,0.85)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          zIndex: 1100,
                          padding: '20px',
                        }}
                      >
                        <div
                          className="panel-card"
                          style={{
                            maxWidth: '520px',
                            width: '100%',
                            backgroundColor: '#161b22',
                            border: '1px solid #da3633',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '14px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <ShieldAlert size={24} color="#f85149" />
                            <h3 style={{ margin: 0, color: '#f85149' }}>
                              CRITICAL ACTION: Suspend Account
                            </h3>
                          </div>
                          <p
                            style={{
                              margin: 0,
                              fontSize: '13px',
                              color: '#c9d1d9',
                              lineHeight: 1.5,
                            }}
                          >
                            You are about to suspend cPanel account{' '}
                            <strong style={{ color: '#f0f6fc' }}>{suspendTarget.user}</strong> (
                            {suspendTarget.domain}). All websites, databases, and incoming emails
                            for this account will immediately stop responding.
                          </p>
                          <div>
                            <label
                              style={{
                                display: 'block',
                                fontSize: '12px',
                                color: '#8b949e',
                                marginBottom: '4px',
                              }}
                            >
                              Reason for Suspension:
                            </label>
                            <input
                              type="text"
                              className="chat-input"
                              style={{ width: '100%' }}
                              value={suspendReason}
                              onChange={(e) => setSuspendReason(e.target.value)}
                            />
                          </div>
                          <div
                            style={{
                              backgroundColor: 'rgba(218, 54, 51, 0.1)',
                              border: '1px solid rgba(218, 54, 51, 0.4)',
                              borderRadius: '6px',
                              padding: '10px',
                            }}
                          >
                            <label
                              style={{
                                display: 'block',
                                fontSize: '12px',
                                color: '#f85149',
                                marginBottom: '6px',
                              }}
                            >
                              Type <strong>{suspendTarget.user}</strong> to confirm:
                            </label>
                            <input
                              type="text"
                              className="chat-input"
                              style={{ width: '100%' }}
                              placeholder={suspendTarget.user}
                              value={typedUsername}
                              onChange={(e) => setTypedUsername(e.target.value)}
                            />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                              className="btn"
                              onClick={() => {
                                setSuspendTarget(null);
                                setTypedUsername('');
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn btn-danger"
                              onClick={handleConfirmSuspend}
                              disabled={typedUsername.trim() !== suspendTarget.user}
                            >
                              Confirm Suspension
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: DOMAINS & SSL */}
                {cpanelTab === 'domains' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '13px' }}>
                      Configured Domains & SSL Status
                    </div>
                    <div
                      style={{
                        overflowX: 'auto',
                        border: '1px solid #21262d',
                        borderRadius: '6px',
                      }}
                    >
                      <table className="data-table" style={{ width: '100%' }}>
                        <thead>
                          <tr>
                            <th>Domain</th>
                            <th>User</th>
                            <th>Type</th>
                            <th>Document Root</th>
                            <th>PHP Version</th>
                            <th>AutoSSL Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cpanelDomains.map((d) => (
                            <tr key={d.domain}>
                              <td style={{ fontWeight: 600, color: '#f0f6fc' }}>{d.domain}</td>
                              <td>{d.user}</td>
                              <td>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    backgroundColor: '#21262d',
                                    color: '#8b949e',
                                  }}
                                >
                                  {d.domain_type}
                                </span>
                              </td>
                              <td
                                style={{
                                  fontSize: '11px',
                                  fontFamily: 'monospace',
                                  color: '#8b949e',
                                }}
                              >
                                {d.document_root}
                              </td>
                              <td>
                                <code style={{ fontSize: '11px', color: '#79c0ff' }}>
                                  {d.php_version ?? 'ea-php82'}
                                </code>
                              </td>
                              <td>
                                {d.ssl_status === 'VALID_AUTOSSL' ? (
                                  <span
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: '10px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      backgroundColor: '#23863626',
                                      color: '#3fb950',
                                      border: '1px solid #23863666',
                                    }}
                                  >
                                    VALID AUTOSSL
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: '10px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      backgroundColor: '#da363326',
                                      color: '#f85149',
                                      border: '1px solid #da363366',
                                    }}
                                  >
                                    {d.ssl_status}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Installed SSL Certificates */}
                    <div
                      style={{
                        fontWeight: 600,
                        color: '#f0f6fc',
                        fontSize: '13px',
                        marginTop: '6px',
                      }}
                    >
                      Installed SSL Certificates ({cpanelSslList.length})
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                        gap: '10px',
                      }}
                    >
                      {cpanelSslList.map((ssl) => (
                        <div
                          key={ssl.domain}
                          style={{
                            backgroundColor: '#0d1117',
                            padding: '10px 12px',
                            borderRadius: '6px',
                            border: '1px solid #21262d',
                            fontSize: '12px',
                          }}
                        >
                          <div style={{ fontWeight: 600, color: '#f0f6fc' }}>{ssl.domain}</div>
                          <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '2px' }}>
                            Issuer: {ssl.issuer ?? "Let's Encrypt"}
                          </div>
                          <div
                            style={{
                              marginTop: '6px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ color: ssl.has_ssl ? '#3fb950' : '#f85149' }}>
                              {ssl.has_ssl ? 'Active Certificate' : 'Missing SSL'}
                            </span>
                            {ssl.days_until_expiration && (
                              <span style={{ color: '#8b949e', fontSize: '11px' }}>
                                Expires in {ssl.days_until_expiration} days
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TAB 4: DAEMONS & SERVICES */}
                {cpanelTab === 'services' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '13px' }}>
                      cPanel & System Service Daemons
                    </div>
                    <div
                      style={{
                        overflowX: 'auto',
                        border: '1px solid #21262d',
                        borderRadius: '6px',
                      }}
                    >
                      <table className="data-table" style={{ width: '100%' }}>
                        <thead>
                          <tr>
                            <th>Daemon Name</th>
                            <th>Monitored</th>
                            <th>Running State</th>
                            <th>Version</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cpanelServices.map((svc) => (
                            <tr key={svc.service_name}>
                              <td style={{ fontWeight: 600, color: '#f0f6fc' }}>
                                <code>{svc.service_name}</code>
                              </td>
                              <td>
                                {svc.monitored ? (
                                  <span style={{ color: '#3fb950', fontSize: '12px' }}>
                                    Yes (Tailwatchd)
                                  </span>
                                ) : (
                                  <span style={{ color: '#8b949e', fontSize: '12px' }}>
                                    Unmonitored
                                  </span>
                                )}
                              </td>
                              <td>
                                {svc.running ? (
                                  <span
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: '10px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      backgroundColor: '#23863626',
                                      color: '#3fb950',
                                      border: '1px solid #23863666',
                                    }}
                                  >
                                    RUNNING
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: '10px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      backgroundColor: '#da363326',
                                      color: '#f85149',
                                      border: '1px solid #da363366',
                                    }}
                                  >
                                    STOPPED
                                  </span>
                                )}
                              </td>
                              <td style={{ fontSize: '12px', color: '#8b949e' }}>
                                {svc.version ?? '&mdash;'}
                              </td>
                              <td>
                                <button
                                  className="btn"
                                  style={{
                                    padding: '3px 8px',
                                    fontSize: '11px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                  onClick={() => handleRestartCpanelService(svc.service_name)}
                                  disabled={cpanelActionLoading === `restart-${svc.service_name}`}
                                >
                                  <RotateCw
                                    size={12}
                                    className={
                                      cpanelActionLoading === `restart-${svc.service_name}`
                                        ? 'spin'
                                        : ''
                                    }
                                  />{' '}
                                  Restart
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB 5: MULTIPHP & BACKUP */}
                {cpanelTab === 'system' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* MultiPHP Section */}
                    <div
                      style={{
                        backgroundColor: '#0d1117',
                        padding: '14px',
                        borderRadius: '6px',
                        border: '1px solid #21262d',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '13px' }}>
                        MultiPHP Manager Status
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        <span style={{ color: '#8b949e' }}>System Default Version:</span>{' '}
                        <code style={{ color: '#79c0ff', fontWeight: 600 }}>
                          {cpanelPhp?.system_default ?? 'ea-php82'}
                        </code>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {cpanelPhp?.installed_versions.map((ver) => (
                          <div
                            key={ver}
                            style={{
                              backgroundColor: '#161b22',
                              padding: '6px 12px',
                              borderRadius: '4px',
                              border: '1px solid #30363d',
                              fontSize: '12px',
                            }}
                          >
                            <span style={{ fontWeight: 600, color: '#f0f6fc' }}>{ver}</span>
                            <span style={{ color: '#8b949e', marginLeft: '6px' }}>
                              ({cpanelPhp.handlers[ver] ?? 'fpm'})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Backup Section */}
                    {cpanelBackup && (
                      <div
                        style={{
                          backgroundColor: '#0d1117',
                          padding: '14px',
                          borderRadius: '6px',
                          border: '1px solid #21262d',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                        }}
                      >
                        <div style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '13px' }}>
                          cPanel Automated Backup Configuration
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: '10px',
                            fontSize: '12px',
                          }}
                        >
                          <div>
                            <span style={{ color: '#8b949e' }}>Status:</span>{' '}
                            <span
                              style={{ color: cpanelBackup.backup_enabled ? '#3fb950' : '#f85149' }}
                            >
                              {cpanelBackup.backup_enabled ? 'Active' : 'Disabled'}
                            </span>
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>Archive Type:</span>{' '}
                            <span>{cpanelBackup.backup_type}</span>
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>Destination:</span>{' '}
                            <span>{cpanelBackup.destination_type}</span>
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>Daily Retention:</span>{' '}
                            <span>{cpanelBackup.retention_daily} days</span>
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>Weekly Retention:</span>{' '}
                            <span>{cpanelBackup.retention_weekly} weeks</span>
                          </div>
                          <div>
                            <span style={{ color: '#8b949e' }}>Monthly Retention:</span>{' '}
                            <span>{cpanelBackup.retention_monthly} months</span>
                          </div>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: '#8b949e' }}>Last Run Status:</span>{' '}
                            <span style={{ color: '#f0f6fc' }}>
                              {cpanelBackup.last_run_status ?? 'Success'} (
                              {cpanelBackup.last_run_time ?? 'N/A'})
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                borderTop: '1px solid #21262d',
                paddingTop: '12px',
              }}
            >
              <button className="btn" onClick={() => setCpanelServer(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Milestone M12: Multi-Server Operations Console Modal */}
      {showBatchModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
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
              maxWidth: '1050px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid #21262d',
                paddingBottom: '16px',
              }}
            >
              <div>
                <h3
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    margin: 0,
                    color: '#f0f6fc',
                  }}
                >
                  <Layers size={22} color="#58a6ff" /> Multi-Server Operations Console
                </h3>
                <p style={{ color: '#8b949e', fontSize: '13px', margin: '4px 0 0 0' }}>
                  Milestone M12: Scoped target grouping, parallel diagnostics matrix, and bounded
                  execution with failure isolation.
                </p>
              </div>
              <button
                className="btn"
                style={{ padding: '6px' }}
                onClick={() => setShowBatchModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Target Grouping & Scoping Filter */}
            <div
              style={{
                backgroundColor: '#0d1117',
                padding: '16px',
                borderRadius: '8px',
                border: '1px solid #21262d',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Filter size={15} color="#58a6ff" />
                  <span style={{ fontWeight: 600, color: '#c9d1d9', fontSize: '13px' }}>
                    Target Scope:
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className="btn"
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        backgroundColor: batchSelectorType === 'selected' ? '#1f6feb' : '#21262d',
                        color: batchSelectorType === 'selected' ? '#ffffff' : '#8b949e',
                      }}
                      onClick={() => setBatchSelectorType('selected')}
                    >
                      Selected ({selectedServerIds.length})
                    </button>
                    <button
                      className="btn"
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        backgroundColor: batchSelectorType === 'all' ? '#1f6feb' : '#21262d',
                        color: batchSelectorType === 'all' ? '#ffffff' : '#8b949e',
                      }}
                      onClick={() => setBatchSelectorType('all')}
                    >
                      All Servers ({servers.length})
                    </button>
                    <button
                      className="btn"
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        backgroundColor:
                          batchSelectorType === 'environment' ? '#1f6feb' : '#21262d',
                        color: batchSelectorType === 'environment' ? '#ffffff' : '#8b949e',
                      }}
                      onClick={() => setBatchSelectorType('environment')}
                    >
                      By Environment
                    </button>
                    <button
                      className="btn"
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        backgroundColor: batchSelectorType === 'tag' ? '#1f6feb' : '#21262d',
                        color: batchSelectorType === 'tag' ? '#ffffff' : '#8b949e',
                      }}
                      onClick={() => setBatchSelectorType('tag')}
                    >
                      By Tag
                    </button>
                  </div>
                </div>

                {/* Scope Detail Dropdowns */}
                {batchSelectorType === 'environment' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#8b949e', fontSize: '12px' }}>Environment:</span>
                    <select
                      className="chat-input"
                      style={{ height: '32px', padding: '2px 8px', fontSize: '12px' }}
                      value={batchEnvFilter}
                      onChange={(e) => setBatchEnvFilter(e.target.value as ServerEnvironment)}
                    >
                      <option value="PRODUCTION">PRODUCTION</option>
                      <option value="STAGING">STAGING</option>
                      <option value="DEVELOPMENT">DEVELOPMENT</option>
                      <option value="BACKUP">BACKUP</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </div>
                )}

                {batchSelectorType === 'tag' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#8b949e', fontSize: '12px' }}>Tag:</span>
                    <select
                      className="chat-input"
                      style={{ height: '32px', padding: '2px 8px', fontSize: '12px' }}
                      value={batchTagFilter}
                      onChange={(e) => setBatchTagFilter(e.target.value)}
                    >
                      {allTags.length === 0 ? (
                        <option value="">No tags found</option>
                      ) : (
                        allTags.map((tag) => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                )}
              </div>

              {/* Target count and Resolved Nodes Summary */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderTop: '1px solid #161b22',
                  paddingTop: '8px',
                  fontSize: '12px',
                }}
              >
                <div style={{ color: '#8b949e' }}>
                  Target Resolution: <strong>{resolvedTargets.length} servers</strong> matching
                  current filter.
                  <span style={{ marginLeft: '8px', color: '#58a6ff' }}>
                    [{resolvedTargets.map((s) => s.name).join(', ') || 'No servers match selector'}]
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#8b949e' }}>Concurrency:</span>
                  <select
                    className="chat-input"
                    style={{ height: '28px', padding: '2px 6px', fontSize: '11px' }}
                    value={batchConcurrency}
                    onChange={(e) => setBatchConcurrency(Number(e.target.value))}
                  >
                    <option value={1}>1 (Sequential)</option>
                    <option value={2}>2 Parallel</option>
                    <option value={5}>5 Parallel (Default)</option>
                    <option value={10}>10 Parallel</option>
                  </select>
                  <span style={{ color: '#8b949e' }}>Timeout:</span>
                  <select
                    className="chat-input"
                    style={{ height: '28px', padding: '2px 6px', fontSize: '11px' }}
                    value={batchTimeout}
                    onChange={(e) => setBatchTimeout(Number(e.target.value))}
                  >
                    <option value={10}>10s</option>
                    <option value={30}>30s (Default)</option>
                    <option value={60}>60s</option>
                  </select>
                </div>
              </div>

              {/* Inherited Production Risk Notice (Gate A / Gate C) */}
              {hasProductionTarget && (
                <div
                  style={{
                    backgroundColor: '#da36331a',
                    border: '1px solid #da363344',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: '#f85149',
                    fontSize: '12px',
                  }}
                >
                  <ShieldAlert size={16} />
                  <span>
                    <strong>INHERITED PRODUCTION POLICY ACTIVE:</strong> The resolved target set
                    contains one or more PRODUCTION servers. Read-only diagnostics are safe to run,
                    but any state modifications will inherit high-risk policy and require explicit
                    confirmation code <code>CONFIRM BATCH</code>.
                  </span>
                </div>
              )}
            </div>

            {/* Parallel Diagnostics Matrix Toolbar */}
            <div>
              <div
                style={{
                  color: '#8b949e',
                  fontSize: '12px',
                  fontWeight: 600,
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Fleet Diagnostics Matrix (Parallel Queries)
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <button
                  className="btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor:
                      batchDiagType === 'system_info' && matrixResult ? '#238636' : '#21262d',
                    color: '#f0f6fc',
                  }}
                  onClick={() => handleRunBatchDiagnostics('system_info')}
                  disabled={batchLoading || resolvedTargets.length === 0}
                >
                  <Server size={14} /> System Info Matrix
                </button>
                <button
                  className="btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor:
                      batchDiagType === 'cpu_usage' && matrixResult ? '#238636' : '#21262d',
                    color: '#f0f6fc',
                  }}
                  onClick={() => handleRunBatchDiagnostics('cpu_usage')}
                  disabled={batchLoading || resolvedTargets.length === 0}
                >
                  <Cpu size={14} /> CPU Metrics Matrix
                </button>
                <button
                  className="btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor:
                      batchDiagType === 'memory_usage' && matrixResult ? '#238636' : '#21262d',
                    color: '#f0f6fc',
                  }}
                  onClick={() => handleRunBatchDiagnostics('memory_usage')}
                  disabled={batchLoading || resolvedTargets.length === 0}
                >
                  <Activity size={14} /> Memory Metrics Matrix
                </button>
                <button
                  className="btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor:
                      batchDiagType === 'disk_usage' && matrixResult ? '#238636' : '#21262d',
                    color: '#f0f6fc',
                  }}
                  onClick={() => handleRunBatchDiagnostics('disk_usage')}
                  disabled={batchLoading || resolvedTargets.length === 0}
                >
                  <HardDrive size={14} /> Disk Usage Matrix
                </button>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="chat-input"
                    style={{ width: '90px', height: '34px', fontSize: '12px' }}
                    placeholder="Service..."
                    value={batchServiceName}
                    onChange={(e) => setBatchServiceName(e.target.value)}
                  />
                  <button
                    className="btn"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor:
                        batchDiagType === 'service_status' && matrixResult ? '#238636' : '#21262d',
                      color: '#f0f6fc',
                    }}
                    onClick={() => handleRunBatchDiagnostics('service_status')}
                    disabled={batchLoading || resolvedTargets.length === 0}
                  >
                    <RotateCw size={14} /> Service Health
                  </button>
                </div>
              </div>
            </div>

            {/* Custom Semantic Tool Dispatch Form */}
            <div
              style={{
                backgroundColor: '#0d1117',
                padding: '12px 16px',
                borderRadius: '6px',
                border: '1px solid #21262d',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#8b949e' }}>
                  Execute Semantic Tool Across Fleet
                </span>
                {batchConfirmationCode && (
                  <span style={{ color: '#f85149', fontSize: '12px', fontWeight: 600 }}>
                    Confirmation Required: Type '{batchConfirmationCode}'
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <select
                  className="chat-input"
                  style={{ height: '34px', width: '220px', fontSize: '12px' }}
                  value={customToolName}
                  onChange={(e) => setCustomToolName(e.target.value)}
                >
                  <option value="server.system_info">server.system_info</option>
                  <option value="server.disk_usage">server.disk_usage</option>
                  <option value="server.memory_usage">server.memory_usage</option>
                  <option value="server.cpu_usage">server.cpu_usage</option>
                  <option value="server.load_average">server.load_average</option>
                  <option value="server.process_list">server.process_list</option>
                  <option value="server.network_connections">server.network_connections</option>
                  <option value="cpanel.service_status">cpanel.service_status</option>
                  <option value="server.service_restart">server.service_restart (High Risk)</option>
                </select>
                <input
                  type="text"
                  className="chat-input"
                  style={{ flex: 1, height: '34px', fontSize: '12px', fontFamily: 'monospace' }}
                  placeholder='JSON Arguments e.g. {"service_name": "httpd"}'
                  value={customToolArgs}
                  onChange={(e) => setCustomToolArgs(e.target.value)}
                />
                {batchConfirmationCode ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      className="chat-input"
                      style={{
                        width: '180px',
                        height: '34px',
                        borderColor: '#da3633',
                        color: '#f85149',
                        fontWeight: 600,
                      }}
                      placeholder={`Type ${batchConfirmationCode}`}
                      value={typedBatchConfirmation}
                      onChange={(e) => setTypedBatchConfirmation(e.target.value)}
                    />
                    <button
                      className="btn btn-danger"
                      style={{ height: '34px' }}
                      onClick={handleRunBatchTool}
                      disabled={batchLoading}
                    >
                      Confirm Batch
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-primary"
                    style={{ height: '34px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={handleRunBatchTool}
                    disabled={batchLoading || resolvedTargets.length === 0}
                  >
                    <Play size={14} /> Dispatch Batch
                  </button>
                )}
              </div>
            </div>

            {/* Status / Loading / Error Notice */}
            {batchLoading && (
              <div
                style={{
                  padding: '16px',
                  backgroundColor: '#0d1117',
                  border: '1px solid #1f6feb',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  color: '#58a6ff',
                }}
              >
                <RefreshCw size={18} className="spin" />
                <span>
                  Executing fleet operation in parallel (concurrency limit: {batchConcurrency},
                  per-node timeout: {batchTimeout}s)...
                </span>
              </div>
            )}

            {batchError && (
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: '#da36331a',
                  border: '1px solid #da3633',
                  borderRadius: '6px',
                  color: '#f85149',
                  fontSize: '13px',
                }}
              >
                {batchError}
              </div>
            )}

            {/* Matrix Results Table */}
            {matrixResult && !batchLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Summary Metrics Bar */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#0d1117',
                    padding: '10px 16px',
                    borderRadius: '6px',
                    border: '1px solid #21262d',
                  }}
                >
                  <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                    <span>
                      Total Nodes: <strong>{matrixResult.totalNodes}</strong>
                    </span>
                    <span style={{ color: '#3fb950' }}>
                      Succeeded: <strong>{matrixResult.succeededNodes}</strong>
                    </span>
                    <span style={{ color: matrixResult.failedNodes > 0 ? '#f85149' : '#8b949e' }}>
                      Failed: <strong>{matrixResult.failedNodes}</strong>
                    </span>
                    <span style={{ color: '#8b949e' }}>
                      Query: <code>{matrixResult.diagnosticType}</code>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className="btn"
                      style={{
                        padding: '2px 8px',
                        fontSize: '11px',
                        backgroundColor: batchFilterStatus === 'all' ? '#30363d' : 'transparent',
                      }}
                      onClick={() => setBatchFilterStatus('all')}
                    >
                      All ({matrixResult.totalNodes})
                    </button>
                    <button
                      className="btn"
                      style={{
                        padding: '2px 8px',
                        fontSize: '11px',
                        backgroundColor:
                          batchFilterStatus === 'success' ? '#238636' : 'transparent',
                      }}
                      onClick={() => setBatchFilterStatus('success')}
                    >
                      Succeeded ({matrixResult.succeededNodes})
                    </button>
                    <button
                      className="btn"
                      style={{
                        padding: '2px 8px',
                        fontSize: '11px',
                        backgroundColor: batchFilterStatus === 'failed' ? '#da3633' : 'transparent',
                      }}
                      onClick={() => setBatchFilterStatus('failed')}
                    >
                      Failed ({matrixResult.failedNodes})
                    </button>
                  </div>
                </div>

                {/* Table Comparison View */}
                <div
                  style={{
                    border: '1px solid #21262d',
                    borderRadius: '6px',
                    overflow: 'hidden',
                  }}
                >
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Server Node</th>
                        <th>Environment</th>
                        <th>Status</th>
                        <th>Latency</th>
                        {matrixResult.diagnosticType === 'system_info' && (
                          <>
                            <th>OS & Distro</th>
                            <th>Uptime</th>
                          </>
                        )}
                        {matrixResult.diagnosticType === 'cpu_usage' && (
                          <>
                            <th>Cores</th>
                            <th>CPU Load / Usage</th>
                          </>
                        )}
                        {matrixResult.diagnosticType === 'memory_usage' && (
                          <>
                            <th>RAM Used / Total</th>
                            <th>Usage %</th>
                          </>
                        )}
                        {matrixResult.diagnosticType === 'disk_usage' && (
                          <>
                            <th>Disk Used / Total</th>
                            <th>Usage %</th>
                          </>
                        )}
                        {matrixResult.diagnosticType === 'service_status' && (
                          <>
                            <th>Service Daemon</th>
                            <th>Daemon State</th>
                          </>
                        )}
                        <th>Details / Isolation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixResult.rows
                        .filter((r: DiagnosticsMatrixRow) => {
                          if (batchFilterStatus === 'success') return r.success;
                          if (batchFilterStatus === 'failed') return !r.success;
                          return true;
                        })
                        .map((row: DiagnosticsMatrixRow) => (
                          <tr key={row.serverId}>
                            <td style={{ fontWeight: 600 }}>
                              <div>{row.serverName}</div>
                              <div style={{ fontSize: '11px', color: '#8b949e' }}>
                                {row.hostname}
                              </div>
                            </td>
                            <td>
                              <span
                                style={{
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  backgroundColor:
                                    row.environment === 'PRODUCTION' ? '#da363326' : '#23863626',
                                  color: row.environment === 'PRODUCTION' ? '#f85149' : '#3fb950',
                                }}
                              >
                                {row.environment}
                              </span>
                            </td>
                            <td>
                              {row.success ? (
                                <span
                                  style={{
                                    color: '#3fb950',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                  }}
                                >
                                  <CheckCircle2 size={14} /> Success
                                </span>
                              ) : (
                                <span
                                  style={{
                                    color: '#f85149',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                  }}
                                >
                                  <AlertTriangle size={14} /> Failed
                                </span>
                              )}
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                              {row.durationMs}ms
                            </td>

                            {/* Specific Diagnostic Fields */}
                            {matrixResult.diagnosticType === 'system_info' && (
                              <>
                                <td>
                                  <div>{row.osName ?? 'Unknown OS'}</div>
                                  <div style={{ fontSize: '11px', color: '#8b949e' }}>
                                    Family: {row.distroFamily ?? 'N/A'}
                                  </div>
                                </td>
                                <td>{row.uptimeHuman ?? 'N/A'}</td>
                              </>
                            )}

                            {matrixResult.diagnosticType === 'cpu_usage' && (
                              <>
                                <td>{row.cpuCores ?? 0} Cores</td>
                                <td>
                                  <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                  >
                                    <div
                                      style={{
                                        width: '60px',
                                        height: '6px',
                                        backgroundColor: '#21262d',
                                        borderRadius: '3px',
                                        overflow: 'hidden',
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: `${Math.min(row.cpuUsagePct ?? 0, 100)}%`,
                                          height: '100%',
                                          backgroundColor:
                                            (row.cpuUsagePct ?? 0) > 80 ? '#f85149' : '#3fb950',
                                        }}
                                      />
                                    </div>
                                    <span style={{ fontFamily: 'monospace' }}>
                                      {row.cpuUsagePct ?? 0}%
                                    </span>
                                  </div>
                                </td>
                              </>
                            )}

                            {matrixResult.diagnosticType === 'memory_usage' && (
                              <>
                                <td>
                                  {row.memoryUsedHuman ?? 'N/A'} / {row.memoryTotalHuman ?? 'N/A'}
                                </td>
                                <td>
                                  <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                  >
                                    <div
                                      style={{
                                        width: '60px',
                                        height: '6px',
                                        backgroundColor: '#21262d',
                                        borderRadius: '3px',
                                        overflow: 'hidden',
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: `${Math.min(row.memoryUsagePct ?? 0, 100)}%`,
                                          height: '100%',
                                          backgroundColor:
                                            (row.memoryUsagePct ?? 0) > 85 ? '#f85149' : '#58a6ff',
                                        }}
                                      />
                                    </div>
                                    <span style={{ fontFamily: 'monospace' }}>
                                      {row.memoryUsagePct ?? 0}%
                                    </span>
                                  </div>
                                </td>
                              </>
                            )}

                            {matrixResult.diagnosticType === 'disk_usage' && (
                              <>
                                <td>
                                  {row.primaryDiskUsedHuman ?? 'N/A'} /{' '}
                                  {row.primaryDiskTotalHuman ?? 'N/A'}
                                </td>
                                <td>
                                  <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                  >
                                    <div
                                      style={{
                                        width: '60px',
                                        height: '6px',
                                        backgroundColor: '#21262d',
                                        borderRadius: '3px',
                                        overflow: 'hidden',
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: `${Math.min(row.primaryDiskUsagePct ?? 0, 100)}%`,
                                          height: '100%',
                                          backgroundColor:
                                            (row.primaryDiskUsagePct ?? 0) > 90
                                              ? '#f85149'
                                              : '#238636',
                                        }}
                                      />
                                    </div>
                                    <span style={{ fontFamily: 'monospace' }}>
                                      {row.primaryDiskUsagePct ?? 0}%
                                    </span>
                                  </div>
                                </td>
                              </>
                            )}

                            {matrixResult.diagnosticType === 'service_status' && (
                              <>
                                <td>
                                  <code>{row.serviceName ?? batchServiceName}</code>
                                </td>
                                <td>
                                  <span
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: '10px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      backgroundColor: row.serviceActive
                                        ? '#23863626'
                                        : '#da363326',
                                      color: row.serviceActive ? '#3fb950' : '#f85149',
                                    }}
                                  >
                                    {row.serviceStatusText ??
                                      (row.serviceActive ? 'active' : 'inactive')}
                                  </span>
                                </td>
                              </>
                            )}

                            <td style={{ fontSize: '11px', color: '#8b949e' }}>
                              {row.error ? (
                                <span style={{ color: '#f85149' }}>Error: {row.error}</span>
                              ) : (
                                <span style={{ color: '#3fb950' }}>Node Isolated & Healthy</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Semantic Batch Execution Results */}
            {batchAggregateResult && !batchLoading && (
              <div
                style={{
                  backgroundColor: '#0d1117',
                  padding: '16px',
                  borderRadius: '6px',
                  border: '1px solid #21262d',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <h4 style={{ margin: 0, color: '#f0f6fc' }}>
                      Batch Execution Summary ({batchAggregateResult.toolName})
                    </h4>
                    <span style={{ fontSize: '12px', color: '#8b949e' }}>
                      Batch ID: {batchAggregateResult.batchId}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                    <span>
                      Total: <strong>{batchAggregateResult.totalNodes}</strong>
                    </span>
                    <span style={{ color: '#3fb950' }}>
                      Succeeded: <strong>{batchAggregateResult.succeededNodes}</strong>
                    </span>
                    <span
                      style={{
                        color: batchAggregateResult.failedNodes > 0 ? '#f85149' : '#8b949e',
                      }}
                    >
                      Failed: <strong>{batchAggregateResult.failedNodes}</strong>
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '10px',
                  }}
                >
                  {batchAggregateResult.nodes.map((node: NodeExecutionResult) => (
                    <div
                      key={node.serverId}
                      style={{
                        backgroundColor: '#161b22',
                        border: `1px solid ${node.success ? '#23863644' : '#da363344'}`,
                        borderRadius: '6px',
                        padding: '12px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '6px',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: '#f0f6fc' }}>{node.serverName}</span>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: node.success ? '#3fb950' : '#f85149',
                          }}
                        >
                          {node.success ? 'SUCCESS' : 'FAILED'} ({node.durationMs}ms)
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '6px' }}>
                        Host: {node.hostname} | Env: {node.environment}
                      </div>
                      {node.error && (
                        <div style={{ color: '#f85149', fontSize: '12px', marginTop: '4px' }}>
                          {node.error}
                        </div>
                      )}
                      {node.stdout && (
                        <pre
                          style={{
                            margin: 0,
                            backgroundColor: '#0d1117',
                            padding: '6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            color: '#c9d1d9',
                            overflowX: 'auto',
                            maxHeight: '80px',
                          }}
                        >
                          {node.stdout}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                borderTop: '1px solid #21262d',
                paddingTop: '16px',
              }}
            >
              <button className="btn" onClick={() => setShowBatchModal(false)}>
                Close Console
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
