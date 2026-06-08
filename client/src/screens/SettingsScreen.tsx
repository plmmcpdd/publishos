import { useState } from 'react';

export default function SettingsScreen() {
  const [accounts, setAccounts] = useState([
    { id: '1', platform: 'tiktok', username: '@acme_hvac', connected: true },
    { id: '2', platform: 'instagram', username: '@acme_hvac', connected: false },
  ]);

  const toggleAccount = (id: string) => {
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, connected: !a.connected } : a))
    );
  };

  return (
    <div>
      <div className="screen-header">
        <h2>Settings</h2>
        <p>Manage accounts and preferences</p>
      </div>

      <div className="settings-section card" style={{ marginBottom: 20 }}>
        <h3>Connected Accounts</h3>
        <div className="account-list">
          {accounts.map((acc) => (
            <div key={acc.id} className="account-item">
              <div className="account-info">
                <span className="platform-icon">{acc.platform === 'tiktok' ? '🎵' : '📷'}</span>
                <div>
                  <div className="account-name">{acc.platform}</div>
                  <div className="account-handle">{acc.username}</div>
                </div>
              </div>
              <button
                className={`btn ${acc.connected ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => toggleAccount(acc.id)}
              >
                {acc.connected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section card">
        <h3>Preferences</h3>
        <div className="pref-item">
          <label>Download folder</label>
          <input type="text" value="~/Downloads/PublishOS" readOnly />
        </div>
        <div className="pref-item">
          <label>Backend URL</label>
          <input type="text" defaultValue="http://localhost:3000" />
        </div>
        <div className="pref-item">
          <label>
            <input type="checkbox" defaultChecked />
            Show notifications in system tray
          </label>
        </div>
        <div className="pref-item">
          <label>
            <input type="checkbox" />
            Launch at login
          </label>
        </div>
      </div>
    </div>
  );
}
