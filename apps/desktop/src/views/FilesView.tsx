import React, { useState } from 'react';
import { ServerProfile } from '@remote-commander/shared-types';
import { Folder, FileText, Upload, Download, ArrowUp, RefreshCw } from 'lucide-react';

interface FilesViewProps {
  activeServer?: ServerProfile | undefined;
}

export const FilesView: React.FC<FilesViewProps> = ({ activeServer }) => {
  const [currentPath, setCurrentPath] = useState('/etc');
  const [activeTab, setActiveTab] = useState<'remote' | 'local'>('remote');

  const sampleFiles = [
    { name: 'nginx', isDir: true, size: '-', mod: '2026-09-15 11:20' },
    { name: 'apache2', isDir: true, size: '-', mod: '2026-09-18 08:42' },
    { name: 'php', isDir: true, size: '-', mod: '2026-09-12 14:10' },
    { name: 'hosts', isDir: false, size: '248 B', mod: '2026-09-01 09:00' },
    { name: 'resolv.conf', isDir: false, size: '112 B', mod: '2026-09-10 16:30' },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`btn ${activeTab === 'remote' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('remote')}
          >
            Remote ({activeServer?.name ?? 'Server'})
          </button>
          <button
            className={`btn ${activeTab === 'local' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('local')}
          >
            Local Workstation
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Upload size={14} /> Upload
          </button>
          <button className="btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={14} /> Download
          </button>
        </div>
      </div>

      <div
        className="panel-card"
        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px' }}
      >
        <button className="btn" style={{ padding: '4px 8px' }}>
          <ArrowUp size={14} />
        </button>
        <button className="btn" style={{ padding: '4px 8px' }}>
          <RefreshCw size={14} />
        </button>
        <input
          type="text"
          className="chat-input"
          style={{ flex: 1, height: '36px', fontFamily: 'monospace' }}
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
        />
      </div>

      <div className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Last Modified</th>
            </tr>
          </thead>
          <tbody>
            {sampleFiles.map((file) => (
              <tr key={file.name} style={{ cursor: 'pointer' }}>
                <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {file.isDir ? (
                    <Folder size={16} color="#58a6ff" />
                  ) : (
                    <FileText size={16} color="#8b949e" />
                  )}
                  <span>{file.name}</span>
                </td>
                <td>{file.isDir ? 'Directory' : 'File'}</td>
                <td>{file.size}</td>
                <td style={{ color: '#8b949e' }}>{file.mod}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
