import { Routes, Route, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QueueScreen from './screens/QueueScreen';
import HistoryScreen from './screens/HistoryScreen';
import SettingsScreen from './screens/SettingsScreen';
import './App.css';

function App() {
  const { t } = useTranslation();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">PublishOS</h1>
          <span className="version">v1.0.0</span>
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
