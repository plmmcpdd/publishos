import { useEffect, useState } from 'react';
import { fetchAuditLogs } from '../api';
import type { AuditLog as AuditLogItem } from '../api';

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

function actionClass(action: string) {
  if (action.includes('approve') || action.includes('publish')) return 'bg-green-100 text-green-700';
  if (action.includes('reject') || action.includes('failed')) return 'bg-red-100 text-red-700';
  return 'bg-blue-100 text-blue-700';
}

export default function AuditLog() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAuditLogs()
      .then(setLogs)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h3 className="text-lg font-medium mb-4">审计日志</h3>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">时间</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">动作</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">对象</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">操作者</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  加载中...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-red-500">
                  {error}
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  暂无审计记录
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-6 py-4 text-sm">{formatDate(log.createdAt)}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${actionClass(log.action)}`}>{log.action}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {log.targetType} / {log.targetId}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{log.actorId}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
