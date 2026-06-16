import { Link, Outlet, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/', label: '概览', icon: '01' },
  { path: '/review', label: '待审核', icon: '02' },
  { path: '/contents', label: '内容管理', icon: '03' },
  { path: '/customers', label: '客户管理', icon: '04' },
  { path: '/social-accounts', label: '社交账号', icon: '05' },
  { path: '/analytics', label: '效果分析', icon: '06' },
  { path: '/monitor', label: '监控', icon: '07' },
  { path: '/audit', label: '审计日志', icon: '08' },
  { path: '/settings', label: '设置', icon: '09' },
];

export default function Layout() {
  const location = useLocation();
  const activeLabel = navItems.find((item) => item.path === location.pathname)?.label || '概览';

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
          <p className="text-sm opacity-70">运营后台</p>
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
            退出登录
          </button>
          <div className="mt-3 text-xs opacity-50">PublishOS Dashboard v0.1.0</div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <header className="flex items-center justify-between border-b bg-white px-8 py-4">
          <h2 className="text-lg font-medium">{activeLabel}</h2>
          <div className="flex items-center gap-4">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-sm text-gray-600">系统正常</span>
          </div>
        </header>
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
