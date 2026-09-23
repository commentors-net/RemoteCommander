import React, { useEffect, useState } from 'react';
import {
  Folder,
  FileText,
  Save,
  Trash2,
  RefreshCw,
  FolderUp,
  FileCode,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../api.js';

export const FilesView: React.FC = () => {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadDirectory = async (targetPath = currentPath) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await apiRequest(`/api/files/list?path=${encodeURIComponent(targetPath)}`);
      setFiles(res.files || []);
      setCurrentPath(res.currentPath || '');
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Failed to list directory', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory('');
  }, []);

  const openFile = async (relativePath: string) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await apiRequest(`/api/files/read?path=${encodeURIComponent(relativePath)}`);
      setSelectedFile(relativePath);
      setFileContent(res.content || '');
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Failed to read file', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    setStatusMessage(null);
    try {
      await apiRequest('/api/files/write', {
        method: 'POST',
        body: JSON.stringify({ path: selectedFile, content: fileContent }),
      });
      setStatusMessage({ text: `File saved successfully (backup created)`, type: 'success' });
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Failed to save file', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (relativePath: string) => {
    if (!window.confirm(`Are you sure you want to delete ${relativePath}?`)) return;
    try {
      await apiRequest('/api/files/delete', {
        method: 'POST',
        body: JSON.stringify({ path: relativePath }),
      });
      if (selectedFile === relativePath) {
        setSelectedFile(null);
        setFileContent('');
      }
      loadDirectory();
    } catch (err: any) {
      setStatusMessage({ text: err.message || 'Failed to delete', type: 'error' });
    }
  };

  const navigateUp = () => {
    if (!currentPath || currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    loadDirectory(parts.join('/'));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* File List Panel */}
      <div
        style={{
          width: '380px',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary)',
        }}
      >
        {/* Path bar */}
        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
            <button
              type="button"
              className="btn"
              style={{ padding: '4px 6px' }}
              onClick={navigateUp}
              disabled={!currentPath || currentPath === '/'}
              title="Navigate Up"
            >
              <FolderUp size={14} />
            </button>
            <span style={{ fontSize: '12px', color: '#c9d1d9', fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              /{currentPath}
            </span>
          </div>

          <button type="button" className="btn" style={{ padding: '4px 8px' }} onClick={() => loadDirectory()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* File items list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {files.map((file) => {
            const isSelected = selectedFile === file.relativePath;
            return (
              <div
                key={file.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? '#1f242c' : 'transparent',
                  marginBottom: '2px',
                }}
                onClick={() => {
                  if (file.isDirectory) {
                    loadDirectory(file.relativePath);
                  } else {
                    openFile(file.relativePath);
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  {file.isDirectory ? (
                    <Folder size={16} color="#58a6ff" />
                  ) : (
                    <FileText size={16} color="#8b949e" />
                  )}
                  <span
                    style={{
                      fontSize: '13px',
                      color: file.isDirectory ? '#58a6ff' : '#c9d1d9',
                      fontWeight: file.isDirectory ? 600 : 400,
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {file.name}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#8b949e' }}>
                    {file.isDirectory ? '' : formatSize(file.sizeBytes)}
                  </span>
                  <button
                    type="button"
                    style={{ border: 'none', background: 'transparent', color: '#8b949e', cursor: 'pointer', padding: '2px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteItem(file.relativePath);
                    }}
                    title="Delete item"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
          {files.length === 0 && !loading && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#8b949e', fontSize: '12px' }}>
              Directory is empty
            </div>
          )}
        </div>
      </div>

      {/* File Editor Panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        {/* Editor Toolbar */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileCode size={16} color="#58a6ff" />
            <span style={{ fontSize: '13px', fontWeight: 600 }}>
              {selectedFile ? selectedFile : 'No file selected'}
            </span>
          </div>

          {selectedFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveFile}
                disabled={saving}
              >
                <Save size={14} />
                {saving ? 'Saving...' : 'Save File'}
              </button>
            </div>
          )}
        </div>

        {statusMessage && (
          <div
            style={{
              padding: '8px 16px',
              backgroundColor: statusMessage.type === 'success' ? 'rgba(35, 134, 54, 0.2)' : 'rgba(218, 54, 51, 0.2)',
              borderBottom: '1px solid var(--border-color)',
              color: statusMessage.type === 'success' ? '#3fb950' : '#f85149',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {statusMessage.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {statusMessage.text}
          </div>
        )}

        {/* Text Area */}
        <div style={{ flex: 1, position: 'relative' }}>
          {selectedFile ? (
            <textarea
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: 'transparent',
                color: '#c9d1d9',
                border: 'none',
                outline: 'none',
                padding: '16px',
                fontFamily: 'monospace',
                fontSize: '13px',
                lineHeight: '1.6',
                resize: 'none',
              }}
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              spellCheck={false}
            />
          ) : (
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#8b949e',
                fontSize: '13px',
                gap: '8px',
              }}
            >
              <FileText size={36} color="#30363d" />
              <span>Select a file from the left panel to inspect or edit</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
