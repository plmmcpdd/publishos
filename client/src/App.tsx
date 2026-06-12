import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QueueScreen from './screens/QueueScreen';
import HistoryScreen from './screens/HistoryScreen';
import SettingsScreen from './screens/SettingsScreen';
import LoginScreen from './screens/LoginScreen';
import './App.css';

function App() {
  const { t } = useTranslation();
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [clientName, setClientName] = useState(() => localStorage.getItem('clientName') || '');
  const clientId = localStorage.getItem('clientId') || '';

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('clientId');
    localStorage.removeItem('clientName');
    setToken(null);
    setClientName('');
  };

  if (!token) {
    return (
      <LoginScreen
        onLogin={(nextToken, client) => {
          setToken(nextToken);
          setClientName(client.name);
        }}
      />
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">PublishOS</h1>
          <span className="version">v1.0.0</span>
        </div>
        <div className="client-id-pill">ID: {clientId}</div>
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
          {clientName && <div className="client-name">{clientName}</div>}
          <div className="connection-status online">
            <span className="dot" /> {t('nav.connected')}
          </div>
          <button type="button" className="logout-button" onClick={handleLogout}>
            Sign Out
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
