import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api, checkServerConnection, fetchTikTokBindings, getTikTokAuthUrl, disconnectTikTokBinding } from '../api';
import type { TikTokBinding } from '../api';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <div className="toggle-knob" />
    </div>
  );
}

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const [backendUrl, setBackendUrl] = useState(api.base);
  const [connStatus, setConnStatus] = useState<'connected' | 'failed' | null>(null);
  const [tiktokBindings, setTiktokBindings] = useState<TikTokBinding[]>([]);
  const [bindingLoading, setBindingLoading] = useState(false);

  const [notify, setNotify] = useState(true);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);

  useEffect(() => {
    fetchTikTokBindings().then(setTiktokBindings).catch(() => {});
  }, []);

  const handleConnectTikTok = async () => {
    try {
      setBindingLoading(true);
      const authUrl = await getTikTokAuthUrl();
      // Open in system browser - TikTok will redirect to server callback
      if (window.electronAPI?.openTikTokAuth) {
        await window.electronAPI.openTikTokAuth(authUrl);
      } else {
        window.open(authUrl, '_blank');
      }
      // Poll for new binding (server handles the callback)
      const pollInterval = setInterval(async () => {
        try {
          const bindings = await fetchTikTokBindings();
          if (bindings.length > tiktokBindings.length) {
            clearInterval(pollInterval);
            setTiktokBindings(bindings);
            setBindingLoading(false);
            alert('TikTok connected!');
          }
        } catch { /* keep polling */ }
      }, 2000);
      // Stop polling after 5 minutes
      setTimeout(() => { clearInterval(pollInterval); setBindingLoading(false); }, 300000);
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setBindingLoading(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnectTikTokBinding(id);
      setTiktokBindings((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const changeLang = (lang: string) => {
    localStorage.setItem('publishos.language', lang);
    void i18n.changeLanguage(lang);
  };

  return (
    <div className="content-area">
      <div className="topbar">
        <div className="topbar-title">{t('settings.title')}</div>
        <div className="topbar-badge">
          <span className="status-dot online" />
          {t('common.connected')}
        </div>
      </div>

      <div className="screen-header">
        <h2>{t('settings.heading')}</h2>
        <p>{t('settings.subtitle')}</p>
      </div>

      <div className="section-label">{t('settings.account')}</div>
      {tiktokBindings.length === 0 ? (
        <div className="card" style={{ margin: '0 16px 14px', padding: 20, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>No TikTok account connected</p>
          <button
            className="btn btn-primary"
            onClick={() => void handleConnectTikTok()}
            disabled={bindingLoading}
          >
            {bindingLoading ? 'Connecting...' : 'Connect TikTok'}
          </button>
        </div>
      ) : (
        tiktokBindings.map((binding) => (
          <div key={binding.id} className="card" style={{ margin: '0 16px 14px' }}>
            <div className="setting-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="account-avatar">T</div>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>TikTok</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
                    @{binding.username || binding.accountUsername}
                    {binding.status === 'active' ? ' · Connected' : ' · Expired'}
                  </div>
                </div>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => void handleDisconnect(binding.id)}
              >
                Disconnect
              </button>
            </div>
          </div>
        ))
      )}

      <div className="section-label" style={{ marginTop: 8 }}>{t('settings.preferences')}</div>

      <div className="card" style={{ margin: '0 16px 14px' }}>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.systemTrayNotifications')}</div>
            <div className="setting-desc">{t('settings.systemTrayNotificationsDesc')}</div>
          </div>
          <Toggle checked={notify} onChange={setNotify} />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.launchAtLogin')}</div>
            <div className="setting-desc">{t('settings.launchAtLoginDesc')}</div>
          </div>
          <Toggle checked={launchAtLogin} onChange={setLaunchAtLogin} />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.language')}</div>
            <div className="setting-desc">{t('settings.languageDesc')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn ${i18n.language === 'en' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => changeLang('en')}
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              {t('settings.english')}
            </button>
            <button
              className={`btn ${i18n.language === 'zh' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => changeLang('zh')}
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              {t('settings.chinese')}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ margin: '0 16px 14px' }}>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.backendUrl')}</div>
            <div className="setting-desc">{t('settings.backendUrlDesc')}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              style={{ width: 200, textAlign: 'right' }}
            />
            <button
              onClick={async () => {
                api.setBase(backendUrl);
                const result = await checkServerConnection();
                setConnStatus(result.ok ? 'connected' : 'failed');
                setTimeout(() => setConnStatus(null), 3000);
              }}
              style={{
                padding: '6px 10px', borderRadius: 6, border: 'none',
                background: connStatus === 'connected' ? '#059669' : connStatus === 'failed' ? '#dc2626' : 'var(--accent-primary)',
                color: '#fff', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {connStatus === 'connected' ? '✓ OK' : connStatus === 'failed' ? '✗ Fail' : 'Test'}
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.downloadFolder')}</div>
            <div className="setting-desc">{t('settings.downloadFolderDesc')}</div>
          </div>
          <input type="text" defaultValue="~/Downloads/PublishOS" readOnly style={{ width: 200, textAlign: 'right', background: 'var(--surface-hover)' }} />
        </div>
      </div>

      <div style={{ padding: '0 16px 100px' }}>
        <button className="btn btn-danger" style={{ width: '100%' }}>
          {t('settings.signOut')}
        </button>
      </div>
    </div>
  );
}
