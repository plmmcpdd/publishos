import { useEffect, useState } from 'react';
import { createClient, deleteClient, fetchClients, resetClientPassword, updateClient } from '../api';
import type { Client } from '../api';

const emptyForm = { name: '', email: '', password: '', industry: '' };

export default function CustomerList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadClients = async () => {
    setLoading(true);
    setError('');
    try {
      setClients(await fetchClients());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载客户失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadClients();
  }, []);

  const resetForm = () => {
    setShowCreate(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleCreate = async () => {
    try {
      await createClient(form);
      resetForm();
      await loadClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建客户失败');
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    try {
      await updateClient(editing.id, { name: form.name, email: form.email, industry: form.industry });
      resetForm();
      await loadClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新客户失败');
    }
  };

  const handleResetPassword = async (id: string) => {
    const password = prompt('新密码：');
    if (!password) return;
    await resetClientPassword(id, password);
    alert('密码已更新');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该客户？')) return;
    await deleteClient(id);
    await loadClients();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium">客户管理</h3>
        <button
          type="button"
          onClick={() => {
            setShowCreate((value) => !value);
            setEditing(null);
            setForm(emptyForm);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
        >
          + 新建客户
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {(showCreate || editing) && (
        <div className="bg-gray-50 rounded-lg p-6 mb-6 border border-gray-200">
          <h4 className="text-lg font-semibold mb-4">{editing ? '编辑客户' : '新建客户'}</h4>
          <div className="grid grid-cols-2 gap-4">
            <input placeholder="公司名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="行业" value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="邮箱" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="border rounded px-3 py-2" />
            {!editing && (
              <input type="password" placeholder="密码" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="border rounded px-3 py-2" />
            )}
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => void (editing ? handleUpdate() : handleCreate())} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg">
              {editing ? '保存' : '创建'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 bg-gray-300 hover:bg-gray-400 rounded-lg">
              取消
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-6 py-8 text-center text-gray-500">加载中...</div>
        ) : clients.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">暂无客户</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {clients.map((client) => (
              <div key={client.id} className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{client.name}</h4>
                  <p className="text-sm text-gray-500">
                    {client.email} / {client.industry || '-'} / {client.active ? '启用' : '停用'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditing(client);
                      setShowCreate(false);
                      setForm({ name: client.name, email: client.email, password: '', industry: client.industry || '' });
                    }}
                    className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm"
                  >
                    编辑
                  </button>
                  <button onClick={() => void handleResetPassword(client.id)} className="px-3 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded text-sm">
                    重置密码
                  </button>
                  <button onClick={() => void handleDelete(client.id)} className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-sm">
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
