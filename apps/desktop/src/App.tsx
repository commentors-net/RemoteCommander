import React, { useState, useEffect } from 'react';
import { ViewMode } from './index.js';
import { ServerProfile, PermissionMode } from '@remote-commander/shared-types';
import { Bridge, AppInfo } from './bridge.js';
import { Navigation } from './components/Navigation.js';
import { Header } from './components/Header.js';
import { ChatView } from './views/ChatView.js';
import { ServersView } from './views/ServersView.js';
import { TerminalView } from './views/TerminalView.js';
import { FilesView } from './views/FilesView.js';
import { ActivityView } from './views/ActivityView.js';
import { SettingsView } from './views/SettingsView.js';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewMode>('Chat');
  const [appInfo, setAppInfo] = useState<AppInfo>({
    name: 'RemoteCommander',
    version: '1.0.0',
    default_ssh_port: 22,
    default_whm_port: 2087,
  });
  const [servers, setServers] = useState<ServerProfile[]>([]);
  const [activeServerId, setActiveServerId] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('SAFE_AUTOMATION');
  const [splitView, setSplitView] = useState<boolean>(false);

  useEffect(() => {
    async function init() {
      const info = await Bridge.getAppInfo();
      setAppInfo(info);

      const serverList = await Bridge.listServers();
      setServers(serverList);
      if (serverList.length > 0 && !activeServerId) {
        setActiveServerId(serverList[0]!.id);
      }

      const modeJson = await Bridge.getSetting('permission_mode');
      if (modeJson) {
        try {
          setPermissionMode(JSON.parse(modeJson));
        } catch {
          // fallback default
        }
      }
    }
    init();
  }, []);

  const handleAddServer = async (newServer: ServerProfile) => {
    await Bridge.saveServer(newServer);
    const updated = await Bridge.listServers();
    setServers(updated);
    setActiveServerId(newServer.id);
  };

  const handleDeleteServer = async (id: string) => {
    await Bridge.deleteServer(id);
    const updated = await Bridge.listServers();
    setServers(updated);
    if (activeServerId === id) {
      setActiveServerId(updated[0]?.id ?? '');
    }
  };

  const handleUpdateMode = async (mode: PermissionMode) => {
    setPermissionMode(mode);
    await Bridge.setSetting('permission_mode', JSON.stringify(mode));
  };

  const activeServer = servers.find((s) => s.id === activeServerId) || servers[0];

  return (
    <div className="app-container">
      <Navigation
        activeView={activeView}
        onSelectView={setActiveView}
        appVersion={appInfo.version}
      />

      <div className="main-wrapper">
        <Header
          servers={servers}
          activeServerId={activeServerId}
          onSelectServer={setActiveServerId}
          permissionMode={permissionMode}
          onChangeMode={handleUpdateMode}
        />

        <main
          className="content-pane"
          style={
            splitView ? { display: 'flex', gap: '16px', height: 'calc(100vh - 80px)' } : undefined
          }
        >
          {splitView ? (
            <>
              <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                <ChatView activeServer={activeServer} />
              </div>
              <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                <TerminalView
                  activeServer={activeServer}
                  splitMode={true}
                  onToggleSplit={() => setSplitView(false)}
                />
              </div>
            </>
          ) : (
            <>
              {activeView === 'Chat' && <ChatView activeServer={activeServer} />}
              {activeView === 'Servers' && (
                <ServersView
                  servers={servers}
                  onAddServer={handleAddServer}
                  onDeleteServer={handleDeleteServer}
                />
              )}
              {activeView === 'Terminal' && (
                <TerminalView
                  activeServer={activeServer}
                  splitMode={false}
                  onToggleSplit={() => setSplitView(true)}
                />
              )}
              {activeView === 'Files' && <FilesView activeServer={activeServer} />}
              {activeView === 'Activity' && <ActivityView />}
              {activeView === 'Settings' && (
                <SettingsView currentMode={permissionMode} onUpdateMode={handleUpdateMode} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};
