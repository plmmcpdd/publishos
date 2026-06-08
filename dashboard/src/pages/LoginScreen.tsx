import { useState } from 'react';
import type { FormEvent } from 'react';

const ADMIN_PASSWORD = 'publishos2024';

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (password === ADMIN_PASSWORD) {
      localStorage.setItem('dashboard_auth', 'true');
      onLogin();
      return;
    }

    setError('密码错误');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-deepblue px-4">
      <div className="bg-white rounded-xl p-8 w-full max-w-sm shadow-lg">
        <h1 className="text-2xl font-bold text-center mb-2">PublishOS</h1>
        <p className="text-gray-500 text-center mb-6">运营后台登录</p>
        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium mb-2" htmlFor="dashboard-password">
            管理员密码
          </label>
          <input
            id="dashboard-password"
            type="password"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full px-4 py-3 border rounded-lg mb-4"
          />
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
          <button type="submit" className="w-full py-3 bg-brand-deepblue text-white rounded-lg hover:opacity-90">
            登录
          </button>
        </form>
      </div>
    </div>
  );
}
