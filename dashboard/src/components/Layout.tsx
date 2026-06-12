import { Link, Outlet, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/', label: 'Overview', icon: '01' },
  { path: '/review', label: 'Review Queue', icon: '02' },
  { path: '/contents', label: 'Content', icon: '03' },
  { path: '/customers', label: 'Clients', icon: '04' },
  { path: '/social-accounts', label: 'Social Accounts', icon: '05' },
  { path: '/monitor', label: 'Monitor', icon: '06' },
  { path: '/audit', label: 'Audit Logs', icon: '07' },
  { path: '/settings', label: 'Settings', icon: '08' },
];

export default function Layout() {
  const location = useLocation();
  const activeLabel = navItems.find((item) => item.path === location.pathname)?.label || 'Overview';

  const logout = () => {
    localStorage.removeItem('dashboard_auth');
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminName');
    window.location.reload();
  };

  return (
    <div className="flex h-screen">
      <aside className="flex w-64 flex-col bg-brand-deepblue text-white">
        <div className="p-6">
          <h1 className="text-xl font-bold">PublishOS</h1>
          <p className="text-sm opacity-70">Operations Dashboard</p>
        </div>
        <nav className="flex-1 px-4">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`mb-1 flex items-center gap-3 rounded-lg px-4 py-3 transition ${
                location.pathname === item.path ? 'bg-white/20' : 'hover:bg-white/10'
              }`}
            >
              <span className="text-xs opacity-70">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-4">
          <button type="button" onClick={logout} className="px-4 py-2 text-sm opacity-70 hover:opacity-100">
            Log out
          </button>
          <div className="mt-3 text-xs opacity-50">PublishOS Dashboard v0.1.0</div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <header className="flex items-center justify-between border-b bg-white px-8 py-4">
          <h2 className="text-lg font-medium">{activeLabel}</h2>
          <div className="flex items-center gap-4">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-sm text-gray-600">System healthy</span>
          </div>
        </header>
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
