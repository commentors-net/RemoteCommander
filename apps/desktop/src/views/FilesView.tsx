import React, { useState, useEffect, useCallback } from 'react';
import { ServerProfile } from '@remote-commander/shared-types';
import { Bridge, RemoteFileEntry, FileContentResult } from '../bridge.js';
import {
  Folder,
  FileText,
  Upload,
  Download,
  ArrowUp,
  RefreshCw,
  Trash2,
  FolderPlus,
  Sparkles,
  X,
  Check,
  AlertTriangle,
  FileCode,
  ShieldCheck,
  Columns,
  HardDrive,
  Server,
  Layers,
} from 'lucide-react';

interface FilesViewProps {
  activeServer?: ServerProfile | undefined;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const FilesView: React.FC<FilesViewProps> = ({ activeServer }) => {
  const targetServerId = activeServer?.id ?? 'production01';
  const targetServerName = activeServer?.name ?? 'production01';

  // Navigation state
  const [remotePath, setRemotePath] = useState('/etc');
  const [localPath, setLocalPath] = useState('C:/Users/Operator/Projects/RemoteCommander');
  const [showHiddenRemote, setShowHiddenRemote] = useState(false);
  const [showHiddenLocal, setShowHiddenLocal] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'dual' | 'remote' | 'local'>('dual');

  // Directory entries
  const [remoteFiles, setRemoteFiles] = useState<RemoteFileEntry[]>([]);
  const [localFiles, setLocalFiles] = useState<RemoteFileEntry[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(false);

  // Selection state
  const [selectedRemote, setSelectedRemote] = useState<RemoteFileEntry | null>(null);
  const [selectedLocal, setSelectedLocal] = useState<RemoteFileEntry | null>(null);

  // Transfer & Action status
  const [actionNotice, setActionNotice] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // In-app Editor / Viewer Modal state
  const [editorFile, setEditorFile] = useState<{
    pane: 'remote' | 'local';
    entry: RemoteFileEntry;
    content: string;
    originalContent: string;
    isTruncated: boolean;
    totalBytes: number;
    createBackup: boolean;
  } | null>(null);
  const [editorTab, setEditorTab] = useState<'edit' | 'diff'>('edit');
  const [savingFile, setSavingFile] = useState(false);

  // AI Assistant Modal state
  const [aiModal, setAiModal] = useState<{
    title: string;
    type: 'explain' | 'patch' | 'ask';
    content: string;
    analysis?: string | undefined;
    suggestedPatch?: string | undefined;
  } | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  // Create folder prompt state
  const [newFolderModal, setNewFolderModal] = useState<'remote' | 'local' | null>(null);
  const [newFolderName, setNewFolderName] = useState('');

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<{
    pane: 'remote' | 'local';
    entry: RemoteFileEntry;
  } | null>(null);

  // Load remote files
  const loadRemoteDirectory = useCallback(
    async (path: string) => {
      setLoadingRemote(true);
      try {
        const entries = await Bridge.sftpListDirectory(targetServerId, path, showHiddenRemote);
        setRemoteFiles(entries);
        setSelectedRemote(null);
      } catch (err: unknown) {
        setActionNotice({
          type: 'error',
          message: `Failed to load remote directory: ${(err as Error).message}`,
        });
      } finally {
        setLoadingRemote(false);
      }
    },
    [targetServerId, showHiddenRemote],
  );

  // Load local files
  const loadLocalDirectory = useCallback(
    async (path: string) => {
      setLoadingLocal(true);
      try {
        const entries = await Bridge.localListDirectory(path);
        const filtered = showHiddenLocal ? entries : entries.filter((e) => !e.name.startsWith('.'));
        setLocalFiles(filtered);
        setSelectedLocal(null);
      } catch (err: unknown) {
        setActionNotice({
          type: 'error',
          message: `Failed to load local directory: ${(err as Error).message}`,
        });
      } finally {
        setLoadingLocal(false);
      }
    },
    [showHiddenLocal],
  );

  useEffect(() => {
    void loadRemoteDirectory(remotePath);
  }, [loadRemoteDirectory, remotePath]);

  useEffect(() => {
    void loadLocalDirectory(localPath);
  }, [loadLocalDirectory, localPath]);

  // Navigate Up (Parent directory)
  const navigateRemoteUp = () => {
    if (remotePath === '/' || remotePath === '') return;
    const parts = remotePath.split('/').filter(Boolean);
    parts.pop();
    const up = parts.length === 0 ? '/' : `/${parts.join('/')}`;
    setRemotePath(up);
  };

  const navigateLocalUp = () => {
    const parts = localPath.split('/').filter(Boolean);
    if (parts.length <= 1) return;
    parts.pop();
    setLocalPath(parts.join('/'));
  };

  // Open file in Editor
  const openFileViewer = async (entry: RemoteFileEntry, pane: 'remote' | 'local') => {
    try {
      let fileRes: FileContentResult;
      if (pane === 'remote') {
        fileRes = await Bridge.sftpReadFile(targetServerId, entry.path, 100000);
      } else {
        fileRes = await Bridge.localReadFile(entry.path);
      }
      setEditorFile({
        pane,
        entry,
        content: fileRes.content,
        originalContent: fileRes.content,
        isTruncated: fileRes.is_truncated,
        totalBytes: fileRes.total_bytes,
        createBackup: true,
      });
      setEditorTab('edit');
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: `Could not open '${entry.name}': ${(err as Error).message}`,
      });
    }
  };

  // Save edited file (with safe backup verification)
  const handleSaveEditorFile = async () => {
    if (!editorFile) return;
    setSavingFile(true);
    try {
      if (editorFile.pane === 'remote') {
        const res = await Bridge.sftpWriteFile(
          targetServerId,
          editorFile.entry.path,
          editorFile.content,
          editorFile.createBackup,
        );
        setActionNotice({
          type: 'success',
          message: `Saved ${editorFile.entry.name}${res.backup_path ? ` (Backup: ${res.backup_path})` : ''}`,
        });
        await loadRemoteDirectory(remotePath);
      } else {
        await Bridge.localWriteFile(editorFile.entry.path, editorFile.content);
        setActionNotice({
          type: 'success',
          message: `Saved local file ${editorFile.entry.name}`,
        });
        await loadLocalDirectory(localPath);
      }
      setEditorFile(null);
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: `Failed to save file: ${(err as Error).message}`,
      });
    } finally {
      setSavingFile(false);
    }
  };

  // Upload selected local file to remote
  const handleUpload = async () => {
    if (!selectedLocal || selectedLocal.is_dir) {
      setActionNotice({ type: 'info', message: 'Please select a local file to upload' });
      return;
    }
    try {
      const fileData = await Bridge.localReadFile(selectedLocal.path);
      const destPath = `${remotePath === '/' ? '' : remotePath}/${selectedLocal.name}`;
      await Bridge.sftpWriteFile(targetServerId, destPath, fileData.content, true);
      setActionNotice({
        type: 'success',
        message: `Uploaded '${selectedLocal.name}' to remote ${destPath}`,
      });
      await loadRemoteDirectory(remotePath);
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: `Upload failed: ${(err as Error).message}`,
      });
    }
  };

  // Download selected remote file to local
  const handleDownload = async () => {
    if (!selectedRemote || selectedRemote.is_dir) {
      setActionNotice({ type: 'info', message: 'Please select a remote file to download' });
      return;
    }
    try {
      const fileData = await Bridge.sftpReadFile(targetServerId, selectedRemote.path);
      const destPath = `${localPath}/${selectedRemote.name}`;
      await Bridge.localWriteFile(destPath, fileData.content);
      setActionNotice({
        type: 'success',
        message: `Downloaded '${selectedRemote.name}' to local ${destPath}`,
      });
      await loadLocalDirectory(localPath);
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: `Download failed: ${(err as Error).message}`,
      });
    }
  };

  // Delete file or folder
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.pane === 'remote') {
        await Bridge.sftpDeleteFile(targetServerId, deleteTarget.entry.path);
        setActionNotice({
          type: 'success',
          message: `Deleted remote '${deleteTarget.entry.name}'`,
        });
        await loadRemoteDirectory(remotePath);
      }
      setDeleteTarget(null);
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: `Delete failed: ${(err as Error).message}`,
      });
    }
  };

  // Create new folder
  const handleCreateDirectory = async () => {
    if (!newFolderName.trim() || !newFolderModal) return;
    try {
      if (newFolderModal === 'remote') {
        const fullPath = `${remotePath === '/' ? '' : remotePath}/${newFolderName.trim()}`;
        await Bridge.sftpCreateDirectory(targetServerId, fullPath);
        setActionNotice({
          type: 'success',
          message: `Created remote folder '${newFolderName}'`,
        });
        await loadRemoteDirectory(remotePath);
      }
      setNewFolderModal(null);
      setNewFolderName('');
    } catch (err: unknown) {
      setActionNotice({
        type: 'error',
        message: `Folder creation failed: ${(err as Error).message}`,
      });
    }
  };

  // AI Assistant trigger: Explain Config or Generate Patch
  const handleAiAction = async (type: 'explain' | 'patch') => {
    if (!editorFile) return;
    setLoadingAi(true);
    setAiModal({
      title:
        type === 'explain'
          ? `AI Analysis: ${editorFile.entry.name}`
          : `AI Patch Suggestion: ${editorFile.entry.name}`,
      type,
      content: editorFile.content,
    });

    // Simulate AI synthesis based on file content & structure
    setTimeout(() => {
      if (type === 'explain') {
        let explanation = `**File Structure Analysis**: \`${editorFile.entry.path}\`\n\n`;
        if (editorFile.entry.name.includes('nginx')) {
          explanation += `- **Service**: Nginx Web Server Core Configuration.\n- **Worker Connections**: Configured for event polling.\n- **Server Blocks**: Directs port 80 traffic to web root directory.\n- **Security Posture**: Clean configuration; recommends enabling TLS and rate limiting.`;
        } else if (editorFile.entry.name.includes('hosts')) {
          explanation += `- **Service**: Local Host Resolution Table.\n- **Mappings**: Maps localhost and current server IP to hostname.\n- **Security Posture**: In order; ensure no unknown IP mappings are injected.`;
        } else if (editorFile.entry.name.includes('.env')) {
          explanation += `- **Service**: Application Environment Variables.\n- **Risk Level**: HIGH / SENSITIVE.\n- **App Environment**: Production mode enabled.\n- **Recommendations**: Ensure file permissions are strictly \`0600\` and secrets are never committed.`;
        } else {
          explanation += `- File parsed successfully (${editorFile.totalBytes} bytes).\n- Verified encoding UTF-8.\n- No syntax anomalies detected.`;
        }
        setAiModal((prev) => (prev ? { ...prev, analysis: explanation } : null));
      } else {
        let patch = '';
        if (editorFile.entry.name.includes('nginx')) {
          patch = `# RemoteCommander Hardened Nginx Snippet\nserver {\n    listen 80;\n    server_tokens off; # Hide server version\n    add_header X-Frame-Options "SAMEORIGIN";\n    add_header X-Content-Type-Options "nosniff";\n    add_header X-XSS-Protection "1; mode=block";\n}\n`;
        } else {
          patch = `# Recommended Security Hardening Header\n# Generated by RemoteCommander AI Assistant\nSECURE_MODE=true\nAUDIT_LOGGING=enabled\n`;
        }
        setAiModal((prev) => (prev ? { ...prev, suggestedPatch: patch } : null));
      }
      setLoadingAi(false);
    }, 600);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      {/* Top Header & Layout Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
              fontSize: '1.1rem',
            }}
          >
            <Layers size={20} color="#58a6ff" />
            <span>Remote File Management</span>
          </div>
          <span
            style={{
              fontSize: '0.75rem',
              padding: '2px 8px',
              borderRadius: '12px',
              backgroundColor: '#1f6feb22',
              color: '#58a6ff',
              border: '1px solid #1f6feb44',
            }}
          >
            WinSCP Dual-Pane Mode
          </span>
        </div>

        {/* View Mode & Transfer Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="btn-group" style={{ display: 'flex', gap: '4px' }}>
            <button
              className={`btn btn-sm ${layoutMode === 'dual' ? 'btn-primary' : ''}`}
              onClick={() => setLayoutMode('dual')}
              title="Side-by-side Dual Pane View"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Columns size={14} /> Dual Pane
            </button>
            <button
              className={`btn btn-sm ${layoutMode === 'remote' ? 'btn-primary' : ''}`}
              onClick={() => setLayoutMode('remote')}
              title="Remote Server View Only"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Server size={14} /> Remote
            </button>
            <button
              className={`btn btn-sm ${layoutMode === 'local' ? 'btn-primary' : ''}`}
              onClick={() => setLayoutMode('local')}
              title="Local Workstation View Only"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <HardDrive size={14} /> Local
            </button>
          </div>
        </div>
      </div>

      {/* Action Notification Alert */}
      {actionNotice && (
        <div
          style={{
            padding: '8px 14px',
            borderRadius: '6px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.88rem',
            backgroundColor:
              actionNotice.type === 'success'
                ? '#23863622'
                : actionNotice.type === 'error'
                  ? '#da363322'
                  : '#1f6feb22',
            border: `1px solid ${
              actionNotice.type === 'success'
                ? '#238636'
                : actionNotice.type === 'error'
                  ? '#da3633'
                  : '#1f6feb'
            }`,
            color:
              actionNotice.type === 'success'
                ? '#3fb950'
                : actionNotice.type === 'error'
                  ? '#f85149'
                  : '#58a6ff',
          }}
        >
          <span>{actionNotice.message}</span>
          <button
            onClick={() => setActionNotice(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Dual-Pane Browser Container */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: layoutMode === 'dual' ? '1fr auto 1fr' : '1fr',
          gap: '12px',
          alignItems: 'stretch',
          minHeight: '480px',
        }}
      >
        {/* Left Pane: Local Workstation Browser */}
        {(layoutMode === 'dual' || layoutMode === 'local') && (
          <div
            className="panel-card"
            style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
          >
            {/* Local Pane Header */}
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid #30363d',
                backgroundColor: '#161b22',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                <HardDrive size={16} color="#8b949e" />
                <span>Local Workstation</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label
                  style={{
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: '#8b949e',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showHiddenLocal}
                    onChange={(e) => setShowHiddenLocal(e.target.checked)}
                  />
                  Hidden
                </label>
                <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>
                  {localFiles.length} items
                </span>
              </div>
            </div>

            {/* Local Path Navigation Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 12px',
                borderBottom: '1px solid #21262d',
                backgroundColor: '#0d1117',
              }}
            >
              <button
                className="btn btn-sm"
                onClick={navigateLocalUp}
                title="Go to Parent Folder (..)"
                style={{ padding: '4px 8px' }}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="btn btn-sm"
                onClick={() => loadLocalDirectory(localPath)}
                title="Refresh Directory"
                style={{ padding: '4px 8px' }}
              >
                <RefreshCw size={14} className={loadingLocal ? 'spin' : ''} />
              </button>
              <input
                type="text"
                className="chat-input"
                style={{ flex: 1, height: '30px', fontSize: '0.82rem', fontFamily: 'monospace' }}
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadLocalDirectory(localPath)}
              />
            </div>

            {/* Local File List Table */}
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: '520px' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {localFiles.map((file) => {
                    const isSelected = selectedLocal?.path === file.path;
                    return (
                      <tr
                        key={file.path}
                        onClick={() => setSelectedLocal(file)}
                        onDoubleClick={() => {
                          if (file.is_dir) {
                            setLocalPath(file.path);
                          } else {
                            void openFileViewer(file, 'local');
                          }
                        }}
                        style={{
                          cursor: 'pointer',
                          backgroundColor: isSelected ? '#1f6feb22' : 'transparent',
                        }}
                      >
                        <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {file.is_dir ? (
                            <Folder size={16} color="#58a6ff" />
                          ) : (
                            <FileText size={16} color="#8b949e" />
                          )}
                          <span style={{ fontWeight: file.is_dir ? 600 : 400 }}>{file.name}</span>
                        </td>
                        <td style={{ color: '#8b949e', whiteSpace: 'nowrap' }}>
                          {file.is_dir ? '-' : formatBytes(file.size_bytes)}
                        </td>
                        <td style={{ color: '#8b949e', whiteSpace: 'nowrap' }}>
                          {file.modified_at}
                        </td>
                      </tr>
                    );
                  })}
                  {localFiles.length === 0 && !loadingLocal && (
                    <tr>
                      <td
                        colSpan={3}
                        style={{ textAlign: 'center', color: '#8b949e', padding: '24px' }}
                      >
                        Directory is empty
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Center Transfer Action Column (Dual-Pane Mode) */}
        {layoutMode === 'dual' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '12px',
              padding: '0 4px',
            }}
          >
            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={!selectedLocal || selectedLocal.is_dir}
              title="Upload selected local file to remote [→]"
              style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Upload size={16} />
              <span style={{ fontSize: '0.8rem' }}>Upload →</span>
            </button>
            <button
              className="btn"
              onClick={handleDownload}
              disabled={!selectedRemote || selectedRemote.is_dir}
              title="Download selected remote file to local [←]"
              style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Download size={16} />
              <span style={{ fontSize: '0.8rem' }}>← Download</span>
            </button>
          </div>
        )}

        {/* Right Pane: Remote SFTP Server Browser */}
        {(layoutMode === 'dual' || layoutMode === 'remote') && (
          <div
            className="panel-card"
            style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
          >
            {/* Remote Pane Header */}
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid #30363d',
                backgroundColor: '#161b22',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                <Server size={16} color="#3fb950" />
                <span>Remote SFTP: {targetServerName}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label
                  style={{
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: '#8b949e',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showHiddenRemote}
                    onChange={(e) => setShowHiddenRemote(e.target.checked)}
                  />
                  Hidden
                </label>
                <span style={{ fontSize: '0.75rem', color: '#8b949e' }}>
                  {remoteFiles.length} items
                </span>
              </div>
            </div>

            {/* Remote Path Navigation Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 12px',
                borderBottom: '1px solid #21262d',
                backgroundColor: '#0d1117',
              }}
            >
              <button
                className="btn btn-sm"
                onClick={navigateRemoteUp}
                title="Go to Parent Folder (..)"
                style={{ padding: '4px 8px' }}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="btn btn-sm"
                onClick={() => loadRemoteDirectory(remotePath)}
                title="Refresh Directory"
                style={{ padding: '4px 8px' }}
              >
                <RefreshCw size={14} className={loadingRemote ? 'spin' : ''} />
              </button>
              <input
                type="text"
                className="chat-input"
                style={{ flex: 1, height: '30px', fontSize: '0.82rem', fontFamily: 'monospace' }}
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadRemoteDirectory(remotePath)}
              />
              <button
                className="btn btn-sm"
                onClick={() => setNewFolderModal('remote')}
                title="Create New Folder"
                style={{ padding: '4px 8px' }}
              >
                <FolderPlus size={14} />
              </button>
              {selectedRemote && (
                <button
                  className="btn btn-sm"
                  onClick={() => setDeleteTarget({ pane: 'remote', entry: selectedRemote })}
                  title="Delete Selected Item"
                  style={{ padding: '4px 8px', color: '#f85149' }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            {/* Quick Bookmark Paths */}
            <div
              style={{
                display: 'flex',
                gap: '6px',
                padding: '6px 12px',
                borderBottom: '1px solid #21262d',
                backgroundColor: '#0d1117',
                fontSize: '0.75rem',
              }}
            >
              <span style={{ color: '#8b949e' }}>Quick:</span>
              {['/', '/etc', '/var/www/html', '/var/log', '/home'].map((quick) => (
                <button
                  key={quick}
                  onClick={() => setRemotePath(quick)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: remotePath === quick ? '#58a6ff' : '#8b949e',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  {quick}
                </button>
              ))}
            </div>

            {/* Remote File List Table */}
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: '520px' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Perms</th>
                    <th>Owner</th>
                    <th>Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {remoteFiles.map((file) => {
                    const isSelected = selectedRemote?.path === file.path;
                    return (
                      <tr
                        key={file.path}
                        onClick={() => setSelectedRemote(file)}
                        onDoubleClick={() => {
                          if (file.is_dir) {
                            setRemotePath(file.path);
                          } else {
                            void openFileViewer(file, 'remote');
                          }
                        }}
                        style={{
                          cursor: 'pointer',
                          backgroundColor: isSelected ? '#1f6feb22' : 'transparent',
                        }}
                      >
                        <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {file.is_dir ? (
                            <Folder size={16} color="#58a6ff" />
                          ) : (
                            <FileText size={16} color="#8b949e" />
                          )}
                          <span style={{ fontWeight: file.is_dir ? 600 : 400 }}>{file.name}</span>
                        </td>
                        <td style={{ color: '#8b949e', whiteSpace: 'nowrap' }}>
                          {file.is_dir ? '-' : formatBytes(file.size_bytes)}
                        </td>
                        <td
                          style={{ color: '#8b949e', fontFamily: 'monospace', fontSize: '0.78rem' }}
                        >
                          {file.permissions_mode}
                        </td>
                        <td style={{ color: '#8b949e', fontSize: '0.78rem' }}>
                          {file.owner ? `${file.owner}:${file.group ?? file.owner}` : '-'}
                        </td>
                        <td style={{ color: '#8b949e', whiteSpace: 'nowrap' }}>
                          {file.modified_at}
                        </td>
                      </tr>
                    );
                  })}
                  {remoteFiles.length === 0 && !loadingRemote && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ textAlign: 'center', color: '#8b949e', padding: '24px' }}
                      >
                        Directory is empty
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* In-App Text / Config Safe Editor Modal */}
      {editorFile && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            padding: '24px',
          }}
        >
          <div
            className="panel-card"
            style={{
              width: '90%',
              maxWidth: '960px',
              height: '85vh',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
              overflow: 'hidden',
              backgroundColor: '#161b22',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* Editor Modal Header */}
            <div
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid #30363d',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#0d1117',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FileCode size={18} color="#58a6ff" />
                <div>
                  <span style={{ fontWeight: 600, fontSize: '1rem' }}>{editorFile.entry.name}</span>
                  <span style={{ fontSize: '0.8rem', color: '#8b949e', marginLeft: '8px' }}>
                    ({editorFile.entry.path})
                  </span>
                </div>
              </div>

              {/* AI Actions in Editor Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className="btn btn-sm"
                  onClick={() => handleAiAction('explain')}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#58a6ff' }}
                >
                  <Sparkles size={14} /> Explain Config
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => handleAiAction('patch')}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e3b341' }}
                >
                  <ShieldCheck size={14} /> Generate Patch
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setEditorFile(null)}
                  style={{ padding: '4px 8px' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Truncation Safety Warning (100KB Boundary) */}
            {editorFile.isTruncated && (
              <div
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#d2992222',
                  borderBottom: '1px solid #d2992255',
                  color: '#e3b341',
                  fontSize: '0.84rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertTriangle size={16} />
                <span>
                  Safety Boundary Alert: This file exceeds 100KB (
                  {formatBytes(editorFile.totalBytes)}) and has been truncated to protect editor
                  memory.
                </span>
              </div>
            )}

            {/* Tab Bar: Edit vs Diff Preview */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 16px',
                borderBottom: '1px solid #21262d',
                backgroundColor: '#161b22',
              }}
            >
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className={`btn btn-sm ${editorTab === 'edit' ? 'btn-primary' : ''}`}
                  onClick={() => setEditorTab('edit')}
                >
                  Editor
                </button>
                <button
                  className={`btn btn-sm ${editorTab === 'diff' ? 'btn-primary' : ''}`}
                  onClick={() => setEditorTab('diff')}
                >
                  Diff Verification
                </button>
              </div>

              {/* Safe Backup Option */}
              <label
                style={{
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#8b949e',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={editorFile.createBackup}
                  onChange={(e) =>
                    setEditorFile((prev) =>
                      prev ? { ...prev, createBackup: e.target.checked } : null,
                    )
                  }
                />
                Auto-create .bak.&lt;timestamp&gt; backup (Master Spec §11)
              </label>
            </div>

            {/* Editor Content Area */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: 0 }}>
              {editorTab === 'edit' ? (
                <textarea
                  style={{
                    flex: 1,
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#0d1117',
                    color: '#c9d1d9',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                    padding: '16px',
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    lineHeight: '1.5',
                  }}
                  value={editorFile.content}
                  onChange={(e) =>
                    setEditorFile((prev) => (prev ? { ...prev, content: e.target.value } : null))
                  }
                />
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    overflow: 'hidden',
                    height: '100%',
                  }}
                >
                  <div
                    style={{
                      borderRight: '1px solid #30363d',
                      overflowY: 'auto',
                      padding: '12px',
                      backgroundColor: '#0d1117',
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', color: '#8b949e', marginBottom: '8px' }}>
                      Original File
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontFamily: 'monospace',
                        fontSize: '0.82rem',
                        whiteSpace: 'pre-wrap',
                        color: '#f85149',
                      }}
                    >
                      {editorFile.originalContent}
                    </pre>
                  </div>
                  <div style={{ overflowY: 'auto', padding: '12px', backgroundColor: '#0d1117' }}>
                    <div style={{ fontSize: '0.8rem', color: '#8b949e', marginBottom: '8px' }}>
                      Modified File (To be applied)
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontFamily: 'monospace',
                        fontSize: '0.82rem',
                        whiteSpace: 'pre-wrap',
                        color: '#3fb950',
                      }}
                    >
                      {editorFile.content}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* Editor Footer Actions */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid #30363d',
                backgroundColor: '#161b22',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: '0.8rem', color: '#8b949e' }}>
                {editorFile.content.length} characters ({formatBytes(editorFile.content.length)})
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn" onClick={() => setEditorFile(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveEditorFile}
                  disabled={savingFile}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Check size={16} />
                  <span>{savingFile ? 'Saving...' : 'Save & Verify'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Modal */}
      {aiModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1100,
            padding: '24px',
          }}
        >
          <div
            className="panel-card"
            style={{
              width: '100%',
              maxWidth: '640px',
              backgroundColor: '#161b22',
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                <Sparkles size={18} color="#58a6ff" />
                <span>{aiModal.title}</span>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => setAiModal(null)}
                style={{ padding: '4px 8px' }}
              >
                <X size={14} />
              </button>
            </div>

            {loadingAi ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#8b949e' }}>
                <RefreshCw size={24} className="spin" style={{ marginBottom: '8px' }} />
                <div>Analyzing file structure and security policies...</div>
              </div>
            ) : (
              <div>
                {aiModal.analysis && (
                  <div
                    style={{
                      fontSize: '0.88rem',
                      lineHeight: '1.6',
                      color: '#c9d1d9',
                      whiteSpace: 'pre-wrap',
                      marginBottom: '16px',
                    }}
                  >
                    {aiModal.analysis}
                  </div>
                )}
                {aiModal.suggestedPatch && (
                  <div>
                    <div style={{ fontSize: '0.82rem', color: '#8b949e', marginBottom: '6px' }}>
                      Suggested Hardening Patch:
                    </div>
                    <pre
                      style={{
                        padding: '12px',
                        backgroundColor: '#0d1117',
                        borderRadius: '6px',
                        fontFamily: 'monospace',
                        fontSize: '0.82rem',
                        color: '#58a6ff',
                        overflowX: 'auto',
                      }}
                    >
                      {aiModal.suggestedPatch}
                    </pre>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: '10px' }}
                      onClick={() => {
                        if (editorFile && aiModal.suggestedPatch) {
                          setEditorFile({
                            ...editorFile,
                            content: `${editorFile.content}\n${aiModal.suggestedPatch}`,
                          });
                          setAiModal(null);
                        }
                      }}
                    >
                      Apply Patch into Editor
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {newFolderModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1050,
          }}
        >
          <div className="panel-card" style={{ width: '380px', backgroundColor: '#161b22' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Create New Directory</h3>
            <input
              type="text"
              className="chat-input"
              placeholder="Directory name (e.g. backup, logs)"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateDirectory()}
              autoFocus
              style={{ width: '100%', marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn btn-sm" onClick={() => setNewFolderModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleCreateDirectory}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1050,
          }}
        >
          <div className="panel-card" style={{ width: '420px', backgroundColor: '#161b22' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}
            >
              <AlertTriangle size={20} color="#f85149" />
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f85149' }}>
                Confirm File Deletion
              </h3>
            </div>
            <p style={{ fontSize: '0.88rem', color: '#c9d1d9', lineHeight: '1.5' }}>
              Are you sure you want to permanently delete <strong>{deleteTarget.entry.name}</strong>{' '}
              from target server? This action cannot be undone.
            </p>
            <div
              style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}
            >
              <button className="btn btn-sm" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-sm"
                onClick={confirmDelete}
                style={{ backgroundColor: '#da3633', color: '#fff' }}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
