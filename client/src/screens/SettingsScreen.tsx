import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function SettingsScreen() {
  const { i18n, t } = useTranslation();
  const [accounts, setAccounts] = useState([
    { id: '1', platform: 'tiktok', username: '@acme_hvac', connected: true },
    { id: '2', platform: 'instagram', username: '@acme_hvac', connected: false },
  ]);

  const toggleAccount = (id: string) => {
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, connected: !a.connected } : a))
    );
  };

  const changeLanguage = (language: string) => {
    localStorage.setItem('publishos.language', language);
    void i18n.changeLanguage(language);
  };

  return (
    <div>
      <div className="screen-header">
        <h2>{t('settings.title')}</h2>
        <p>{t('settings.subtitle')}</p>
      </div>

      <div className="settings-section card" style={{ marginBottom: 20 }}>
        <h3>{t('settings.connectedAccounts')}</h3>
        <div className="account-list">
          {accounts.map((acc) => (
            <div key={acc.id} className="account-item">
              <div className="account-info">
                <span className="platform-icon">{acc.platform.slice(0, 1).toUpperCase()}</span>
                <div>
                  <div className="account-name">{acc.platform}</div>
                  <div className="account-handle">{acc.username}</div>
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
        </div>
      </div>

      <div className="settings-section card">
        <h3>{t('settings.preferences')}</h3>
        <div className="pref-item">
          <label>{t('settings.language')}</label>
          <select value={i18n.language} onChange={(e) => changeLanguage(e.target.value)}>
            <option value="en">{t('settings.english')}</option>
            <option value="zh">{t('settings.chinese')}</option>
          </select>
        </div>
        <div className="pref-item">
          <label>{t('settings.downloadFolder')}</label>
          <input type="text" value="~/Downloads/PublishOS" readOnly />
        </div>
        <div className="pref-item">
          <label>{t('settings.backendUrl')}</label>
          <input type="text" defaultValue="http://localhost:3000" />
        </div>
        <div className="pref-item">
          <label>
            <input type="checkbox" defaultChecked />
            {t('settings.showNotifications')}
          </label>
        </div>
        <div className="pref-item">
          <label>
            <input type="checkbox" />
            {t('settings.launchAtLogin')}
          </label>
        </div>
      </div>
    </div>
  );
}
