import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import LoginScreen from './pages/LoginScreen';
import DashboardHome from './pages/DashboardHome';
import ReviewQueue from './pages/ReviewQueue';
import ContentList from './pages/ContentList';
import CustomerList from './pages/CustomerList';
import Settings from './pages/Settings';
import Monitor from './pages/Monitor';
import AuditLog from './pages/AuditLog';
import SocialAccounts from './pages/SocialAccounts';
import Analytics from './pages/Analytics';
import TicketList from './pages/TicketList';
import TicketDetail from './pages/TicketDetail';

function App() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(localStorage.getItem('dashboard_auth') === 'true');
  }, []);

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<DashboardHome />} />
          <Route path="review" element={<ReviewQueue />} />
          <Route path="contents" element={<ContentList />} />
          <Route path="customers" element={<CustomerList />} />
          <Route path="clients" element={<CustomerList />} />
          <Route path="social-accounts" element={<SocialAccounts />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="tickets" element={<TicketList />} />
          <Route path="tickets/:id" element={<TicketDetail />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
