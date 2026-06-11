import { useEffect, useState } from 'react';
import { fetchClients } from '../api';
import type { Client } from '../api';

export default function CustomerList() {
  const [customers, setCustomers] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClients()
      .then(setCustomers)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h3 className="text-lg font-medium mb-4">客户列表</h3>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">客户</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">行业</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-6 py-8 text-center text-gray-500">加载中...</td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-8 text-center text-gray-500">暂无客户</td>
              </tr>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id}>
                  <td className="px-6 py-4 text-sm font-medium">{customer.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{customer.industry || '-'}</td>
                  <td className="px-6 py-4">
                    <span className={`w-2 h-2 rounded-full inline-block mr-2 ${customer.active ? 'bg-green-500' : 'bg-gray-400'}`} />
                    {customer.active ? '活跃' : '暂停'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
