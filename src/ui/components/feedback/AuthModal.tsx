import React, { useState } from 'react';
import { apiClient, UserSessionInfo } from '../../api/apiClient';

interface AuthModalProps {
  isOpen: boolean;
  currentUser: UserSessionInfo | null;
  onClose: () => void;
  onSessionUpdated: (user: UserSessionInfo | null) => void;
  onToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  currentUser,
  onClose,
  onSessionUpdated,
  onToast
}) => {
  const [activeTab, setActiveTab] = useState<'session' | 'apikey'>('session');
  const [username, setUsername] = useState('demo_user');
  const [role, setRole] = useState<'admin' | 'user' | 'readonly' | 'service'>('user');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      onToast('Username is required', 'error');
      return;
    }

    setLoading(true);
    try {
      const user = await apiClient.login(username.trim(), role);
      onSessionUpdated(user);
      onToast(`Authenticated as ${user.username} (${user.role.toUpperCase()})`, 'success');
      onClose();
    } catch (err: any) {
      onToast(`Authentication failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = apiKeyInput.trim();
    if (!cleanKey) {
      apiClient.setApiKey(null);
      onToast('API Key cleared', 'info');
      onClose();
      return;
    }

    if (!cleanKey.startsWith('esp_live_') && !cleanKey.startsWith('esp_test_')) {
      onToast('API key should start with esp_live_ or esp_test_', 'warning');
    }

    apiClient.setApiKey(cleanKey);
    onToast('API key saved for session requests', 'success');
    onClose();
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await apiClient.logout();
      onSessionUpdated(null);
      onToast('Logged out of session', 'info');
      onClose();
    } catch (err: any) {
      onToast(`Logout error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(5, 7, 15, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: '#13182C',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          animation: 'fadeIn 0.2s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>🔐</span>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#FFFFFF' }}>Authentication & Security</h3>
              <p style={{ fontSize: '12px', color: '#94A3B8' }}>Manage session credentials and RBAC tokens</p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94A3B8',
              fontSize: '18px',
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>

        {/* Current User Status Banner */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: '8px',
            backgroundColor: currentUser ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${currentUser ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.08)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px'
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Current Status
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: currentUser ? '#10B981' : '#E2E8F0', marginTop: '2px' }}>
              {currentUser ? `Signed in as ${currentUser.username}` : 'Anonymous / Cookie Session'}
            </div>
          </div>
          {currentUser && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '12px',
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                color: '#818CF8',
                border: '1px solid rgba(99, 102, 241, 0.3)'
              }}
            >
              {currentUser.role.toUpperCase()}
            </span>
          )}
        </div>

        {/* Tab Toggle */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '8px',
            padding: '3px',
            marginBottom: '20px'
          }}
        >
          <button
            onClick={() => setActiveTab('session')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'session' ? '#6366F1' : 'transparent',
              color: activeTab === 'session' ? '#FFFFFF' : '#94A3B8',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            Session Token (JWT)
          </button>
          <button
            onClick={() => setActiveTab('apikey')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: activeTab === 'apikey' ? '#6366F1' : 'transparent',
              color: activeTab === 'apikey' ? '#FFFFFF' : '#94A3B8',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            Programmatic API Key
          </button>
        </div>

        {activeTab === 'session' ? (
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#94A3B8', marginBottom: '6px', fontWeight: 500 }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alice, marketer_bob"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  backgroundColor: '#0B0E1A',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#94A3B8', marginBottom: '6px', fontWeight: 500 }}>
                Role (RBAC Permissions)
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  backgroundColor: '#0B0E1A',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  outline: 'none'
                }}
              >
                <option value="user">Standard User (Scraping, Exports, Folders)</option>
                <option value="admin">Administrator (Full Access, Audits, Settings)</option>
                <option value="readonly">Read-Only (View results, export)</option>
                <option value="service">Integration Service (HUNTIQ Sync, Scrape)</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="submit"
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: '8px',
                  backgroundColor: '#6366F1',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  fontSize: '13px',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? 'Authenticating...' : 'Sign In / Rotate Token'}
              </button>
              {currentUser && (
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loading}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    color: '#EF4444',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                >
                  Logout
                </button>
              )}
            </div>
          </form>
        ) : (
          <form onSubmit={handleSaveApiKey}>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#94A3B8', marginBottom: '6px', fontWeight: 500 }}>
                API Key (X-API-Key Header)
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="esp_live_xxxxxxxxxxxxxxxxxxxxxxxx"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  backgroundColor: '#0B0E1A',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  outline: 'none',
                  fontFamily: 'monospace'
                }}
              />
              <p style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}>
                Stored in browser session memory only; never transmitted in URL or logs.
              </p>
            </div>

            <button
              type="submit"
              style={{
                width: '100%',
                padding: '10px 16px',
                borderRadius: '8px',
                backgroundColor: '#6366F1',
                color: '#FFFFFF',
                fontWeight: 600,
                fontSize: '13px',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Apply API Key to Session
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
