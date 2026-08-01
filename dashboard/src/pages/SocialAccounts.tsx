import { useEffect, useState } from 'react';
import { fetchClients, fetchTikTokBindings } from '../api';
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

  const selectedClientName = clients.find((client) => client.id === selectedClient)?.name ?? '';

  return (
    <div>
      <div className="mb-6">
        <div>
          <h3 className="text-lg font-medium">社交账号</h3>
          <p className="mt-1 text-sm text-gray-500">只读查看客户的 TikTok 连接健康与数据采集状态。</p>
        </div>
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
              <p className="text-sm text-gray-500">客户：{selectedClientName} · {bindings.length} 个当前连接</p>
            </div>
          </div>

          {bindings.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-500">
              客户尚未连接 TikTok。请客户在 PublishOS Client 的 Settings 中完成连接。
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {bindings.map((binding) => (
                <div key={binding.id} className="grid gap-3 px-5 py-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="font-medium">@{binding.username || binding.accountUsername || 'TikTok Account'}</p>
                    <p className="text-sm text-gray-500">当前连接状态：{binding.status === 'active' ? '已连接' : binding.status}</p>
                    <p className="text-sm text-gray-500">
                      已授权 scopes：{binding.grantedScopes?.length ? binding.grantedScopes.join(', ') : '无'}
                    </p>
                    {binding.reauthorizationRequired && (
                      <p className="text-sm font-medium text-amber-700">需要客户在 PublishOS Client 中重新授权。</p>
                    )}
                  </div>
                  <div className="space-y-1 md:text-right">
                    <p className="text-sm text-gray-500">数据采集状态：{binding.collectionStatus || 'idle'}</p>
                    <p className="text-sm text-gray-500">
                      最近成功采集时间：{binding.lastCollectionSuccessAt ? new Date(binding.lastCollectionSuccessAt).toLocaleString() : '暂无'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
