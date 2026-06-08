import { Outlet, Link, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/', label: '概览', icon: '01' },
  { path: '/review', label: '审核流', icon: '02' },
  { path: '/contents', label: '内容管理', icon: '03' },
  { path: '/customers', label: '客户列表', icon: '04' },
  { path: '/settings', label: '设置', icon: '05' },
];

export default function Layout() {
  const location = useLocation();
  const activeLabel = navItems.find((item) => item.path === location.pathname)?.label || '概览';

  return (
    <div className="flex h-screen">
      <aside className="w-64 bg-brand-deepblue text-white flex flex-col">
        <div className="p-6">
          <h1 className="text-xl font-bold">PublishOS</h1>
          <p className="text-sm opacity-70">运营后台</p>
        </div>
        <nav className="flex-1 px-4">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-1 transition ${
                location.pathname === item.path ? 'bg-white/20' : 'hover:bg-white/10'
              }`}
            >
              <span className="text-xs opacity-70">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-4 text-xs opacity-50">PublishOS Dashboard v0.1.0</div>
      </aside>

      <main className="flex-1 overflow-auto">
        <header className="bg-white border-b px-8 py-4 flex justify-between items-center">
          <h2 className="text-lg font-medium">{activeLabel}</h2>
          <div className="flex items-center gap-4">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
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
