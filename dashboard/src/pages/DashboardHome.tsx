import { useEffect, useState } from 'react';
import { fetchStats } from '../api';
import type { Stats } from '../api';

const emptyStats: Stats = {
  todayPublished: 0,
  pending: 0,
  totalCustomers: 0,
  failed: 0,
};

export default function DashboardHome() {
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    { label: '今日发布', value: stats.todayPublished, color: 'text-blue-600' },
    { label: '待审核', value: stats.pending, color: 'text-amber-600' },
    { label: '客户总数', value: stats.totalCustomers, color: 'text-green-600' },
    { label: '失败任务', value: stats.failed, color: 'text-red-600' },
  ];

  return (
    <div>
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">统计加载失败：{error}</div>}
      <div className="grid grid-cols-4 gap-6 mb-8">
        {cards.map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-sm text-gray-500 mb-2">{stat.label}</p>
            <p className={`text-3xl font-bold ${stat.color}`}>{loading ? '-' : stat.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-medium mb-4">最近活动</h3>
        <p className="text-gray-500">审计日志页可查看审核、发布、拒绝等后台操作记录。</p>
      </div>
    </div>
  );
}
