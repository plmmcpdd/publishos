import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardHome from './pages/DashboardHome';
import ReviewQueue from './pages/ReviewQueue';
import ContentList from './pages/ContentList';
import CustomerList from './pages/CustomerList';
import Settings from './pages/Settings';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<DashboardHome />} />
          <Route path="review" element={<ReviewQueue />} />
          <Route path="contents" element={<ContentList />} />
          <Route path="customers" element={<CustomerList />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
