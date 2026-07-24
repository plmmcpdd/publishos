import { useState } from 'react';
import { adminLogin } from '../api';

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError('请输入邮箱和密码');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await adminLogin(email, password);
      localStorage.setItem('adminToken', data.token);
      localStorage.setItem('adminName', data.admin.name);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-deepblue px-4">
      <div className="bg-white rounded-xl p-8 w-full max-w-sm shadow-lg">
        <h1 className="text-2xl font-bold text-center mb-2">PublishOS 运营后台</h1>
        <p className="text-gray-500 text-center mb-6">管理员登录</p>
        {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded mb-4 text-sm">{error}</div>}
        <input
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full border rounded-lg px-4 py-3 mb-3"
        />
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleLogin();
          }}
          className="w-full border rounded-lg px-4 py-3 mb-4"
        />
        <button
          type="button"
          onClick={() => void handleLogin()}
          disabled={loading}
          className="w-full py-3 bg-brand-deepblue text-white rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </div>
    </div>
  );
}
