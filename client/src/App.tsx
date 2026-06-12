import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QueueScreen from './screens/QueueScreen';
import HistoryScreen from './screens/HistoryScreen';
import SettingsScreen from './screens/SettingsScreen';
import { getClientId, setClientId, clearClientId, fetchClients, ClientItem } from './api';
import './App.css';

function ClientSelector({ onSelect }: { onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [customId, setCustomId] = useState('');

  useEffect(() => {
    fetchClients()
      .then(setClients)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (id: string) => {
    setClientId(id);
    onSelect(id);
  };

  const handleCustom = () => {
    if (customId.trim()) {
      handleSelect(customId.trim());
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg)', padding: 24,
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 32,
        width: '100%', maxWidth: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>PublishOS</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{t('client.selectPrompt') || 'Select your client account'}</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 20 }}>
            {t('common.loading')}
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 12 }}>
            <p style={{ fontSize: 13, marginBottom: 12 }}>{t('client.cannotLoad') || 'Cannot load client list'}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
                placeholder={t('client.enterId') || 'Enter Client ID'}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 8,
                  border: '1px solid var(--border)', fontSize: 14,
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleCustom()}
              />
              <button
                onClick={handleCustom}
                style={{
                  padding: '10px 16px', borderRadius: 8, border: 'none',
                  background: 'var(--accent-primary)', color: '#fff',
                  fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                {t('common.confirm') || 'OK'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {clients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelect(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--bg)',
                    cursor: 'pointer', textAlign: 'left', fontSize: 14,
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, background: 'var(--accent-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0,
                  }}>
                    {c.name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    {c.industry && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.industry}</div>}
                  </div>
                </button>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {t('client.orEnterManual') || 'Or enter Client ID manually:'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                  placeholder={t('client.enterId') || 'Enter Client ID'}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 8,
                    border: '1px solid var(--border)', fontSize: 14,
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleCustom()}
                />
                <button
                  onClick={handleCustom}
                  style={{
                    padding: '10px 16px', borderRadius: 8, border: 'none',
                    background: 'var(--accent-primary)', color: '#fff',
                    fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  {t('common.confirm') || 'OK'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const [clientId, setClientState] = useState<string | null>(getClientId());
  const navigate = useNavigate();

  if (!clientId) {
    return <ClientSelector onSelect={(id) => { setClientState(id); navigate('/'); }} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">PublishOS</h1>
          <span className="version">v1.0.0</span>
        </div>
        <div style={{
          padding: '6px 12px', margin: '0 8px 8px', borderRadius: 6,
          background: 'rgba(30, 64, 175, 0.06)', fontSize: 11,
          color: 'var(--text-secondary)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          ID: {clientId}
        </div>
        <nav className="nav">
          <NavLink to="/" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} end>
            <span className="nav-icon">Q</span>
            <span>{t('nav.queue')}</span>
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">H</span>
            <span>{t('nav.history')}</span>
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">S</span>
            <span>{t('nav.settings')}</span>
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="connection-status online">
            <span className="dot" /> {t('nav.connected')}
          </div>
          <button
            onClick={() => { clearClientId(); setClientState(null); }}
            style={{
              marginTop: 8, padding: '4px 8px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'transparent',
              fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            {t('client.switch') || 'Switch Client'}
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<QueueScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
