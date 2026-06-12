import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, checkServerConnection } from '../api';

interface Account {
  id: string;
  platform: 'tiktok' | 'instagram' | 'youtube' | 'facebook';
  username: string;
  connected: boolean;
}

const platformNames: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
};

function AccountAvatar({ platform }: { platform: string }) {
  const initials: Record<string, string> = {
    tiktok: 'T',
    instagram: 'I',
    youtube: 'Y',
    facebook: 'F',
  };
  return <div className="account-avatar">{initials[platform] || platform.charAt(0).toUpperCase()}</div>;
}

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
  const [accounts, setAccounts] = useState<Account[]>([
    { id: '1', platform: 'tiktok', username: '@acme_hvac', connected: true },
    { id: '2', platform: 'instagram', username: '@acme_hvac', connected: false },
  ]);

  const [notify, setNotify] = useState(true);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);

  const toggleAccount = (id: string) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, connected: !a.connected } : a)));
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
      {accounts.map((acc) => (
        <div key={acc.id} className="account-card">
          <AccountAvatar platform={acc.platform} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 2 }}>
              {platformNames[acc.platform] || acc.platform}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
              {acc.username}
            </div>
          </div>
          <button
            className={`btn ${acc.connected ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => toggleAccount(acc.id)}
          >
            {acc.connected ? t('settings.disconnect') : t('settings.connect')}
          </button>
        </div>
      ))}

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
