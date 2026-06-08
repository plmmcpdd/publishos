import { Routes, Route, NavLink } from 'react-router-dom';
import QueueScreen from './screens/QueueScreen';
import HistoryScreen from './screens/HistoryScreen';
import SettingsScreen from './screens/SettingsScreen';
import './App.css';

function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">PublishOS</h1>
          <span className="version">v1.0.0</span>
        </div>
        <nav className="nav">
          <NavLink to="/" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} end>
            <span className="nav-icon">📋</span>
            <span>Queue</span>
            <span className="badge">3</span>
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">📁</span>
            <span>History</span>
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">⚙️</span>
            <span>Settings</span>
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="connection-status online">
            <span className="dot" /> Connected
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
