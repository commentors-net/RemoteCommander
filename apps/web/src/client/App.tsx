import React, { useState, useEffect } from 'react';
import { Sidebar, type ActiveTab } from './components/Sidebar.js';
import { Header } from './components/Header.js';
import { AuthModal } from './components/AuthModal.js';
import { DashboardView } from './views/DashboardView.js';
import { ChatView } from './views/ChatView.js';
import { FilesView } from './views/FilesView.js';
import { WhmView } from './views/WhmView.js';
import { SettingsView } from './views/SettingsView.js';
import { apiRequest } from './api.js';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [serverName, setServerName] = useState('Hosting Server');
  const [whmConnected, setWhmConnected] = useState(false);
  const [whmVersion, setWhmVersion] = useState<string | undefined>(undefined);
  const [uptimeText, setUptimeText] = useState<string | undefined>(undefined);

  const checkStatus = async () => {
    try {
      const [authRes, sysRes, whmRes] = await Promise.allSettled([
        apiRequest('/api/auth/check'),
        apiRequest('/api/system/status'),
        apiRequest('/api/whm/status'),
      ]);

      if (authRes.status === 'fulfilled') {
        setIsAuthenticated(authRes.value.authenticated !== false);
      }

      if (sysRes.status === 'fulfilled' && sysRes.value.data) {
        const d = sysRes.value.data;
        setServerName(d.hostname || 'Hosting Server');
        const hours = Math.floor(d.uptimeSeconds / 3600);
        setUptimeText(`up ${hours}h`);
      }

      if (whmRes.status === 'fulfilled' && whmRes.value.data) {
        setWhmConnected(Boolean(whmRes.value.data.connected));
        setWhmVersion(whmRes.value.data.version);
      }
    } catch {
      // Ignored
    }
  };

  useEffect(() => {
    checkStatus();

    const handleAuthReq = () => setIsAuthenticated(false);
    const handleSettingsUpdated = () => checkStatus();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkStatus();
      }
    };

    window.addEventListener('rc-auth-required', handleAuthReq);
    window.addEventListener('rc-settings-updated', handleSettingsUpdated);
    document.addEventListener('visibilitychange', handleVisibility);

    const interval = setInterval(checkStatus, 30000);

    return () => {
      window.removeEventListener('rc-auth-required', handleAuthReq);
      window.removeEventListener('rc-settings-updated', handleSettingsUpdated);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, []);

  const renderView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView onNavigate={(tab) => setActiveTab(tab)} />;
      case 'chat':
        return <ChatView />;
      case 'files':
        return <FilesView />;
      case 'whm':
        return <WhmView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView onNavigate={(tab) => setActiveTab(tab)} />;
    }
  };

  return (
    <div className="app-container">
      {!isAuthenticated && (
        <AuthModal
          onSuccess={() => {
            setIsAuthenticated(true);
            checkStatus();
          }}
        />
      )}

      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        serverName={serverName}
      />

      <div className="main-content">
        <Header
          whmConnected={whmConnected}
          whmVersion={whmVersion}
          uptimeText={uptimeText}
          onLogout={() => setIsAuthenticated(false)}
        />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {renderView()}
        </div>
      </div>
    </div>
  );
};
