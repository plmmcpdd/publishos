import { useEffect, useState } from 'react';
import {
  disconnectTikTokBinding,
  fetchClients,
  fetchTikTokAuthUrl,
  fetchTikTokBindings,
} from '../api';
import type { Client, SocialBinding } from '../api';

export default function SocialAccounts() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [bindings, setBindings] = useState<SocialBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadClients() {
      setLoading(true);
      setError('');
      try {
        setClients(await fetchClients());
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载客户失败');
      } finally {
        setLoading(false);
      }
    }

    void loadClients();
  }, []);

  const loadBindings = async (clientId: string) => {
    setSelectedClient(clientId);
    setBindings([]);
    if (!clientId) return;
    setError('');
    try {
      setBindings(await fetchTikTokBindings(clientId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载绑定失败');
    }
  };

  const connectTikTok = async () => {
    if (!selectedClient) return;
    try {
      const authUrl = await fetchTikTokAuthUrl(selectedClient);
      window.open(authUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动 TikTok 授权失败');
    }
  };

  const disconnect = async (id: string) => {
    if (!confirm('确定解绑该 TikTok 账号？')) return;
    try {
      await disconnectTikTokBinding(id);
      await loadBindings(selectedClient);
    } catch (err) {
      setError(err instanceof Error ? err.message : '解绑失败');
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">社交账号</h3>
          <p className="mt-1 text-sm text-gray-500">绑定客户的 TikTok 账号以自动发布内容。</p>
        </div>
        {selectedClient && (
          <button
            type="button"
            onClick={() => void connectTikTok()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            绑定 TikTok
          </button>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="client-select">
          选择客户
        </label>
        <select
          id="client-select"
          value={selectedClient}
          onChange={(event) => void loadBindings(event.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          disabled={loading}
        >
          <option value="">{loading ? '加载中...' : '选择客户'}</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name} ({client.email})
            </option>
          ))}
        </select>
      </div>

      {selectedClient && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h4 className="font-medium">TikTok</h4>
              <p className="text-sm text-gray-500">{bindings.length} 个已绑定账号</p>
            </div>
          </div>

          {bindings.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-500">暂无 TikTok 账号绑定</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {bindings.map((binding) => (
                <div key={binding.id} className="flex items-center justify-between px-5 py-4">
                  <div>
                    <p className="font-medium">@{binding.username}</p>
                    <p className="text-sm text-gray-500">
                      状态：{binding.status === 'active' ? '已连接' : binding.status}
                      {binding.expiresAt ? ` / 过期时间：${new Date(binding.expiresAt).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void disconnect(binding.id)}
                    className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500"
                  >
                    解绑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
