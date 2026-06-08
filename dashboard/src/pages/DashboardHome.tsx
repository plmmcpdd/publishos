export default function DashboardHome() {
  const stats = [
    { label: '今日发布', value: 12, color: 'text-blue-600' },
    { label: '待审核', value: 5, color: 'text-amber-600' },
    { label: '客户总数', value: 8, color: 'text-green-600' },
    { label: '失败任务', value: 1, color: 'text-red-600' },
  ];

  return (
    <div>
      <div className="grid grid-cols-4 gap-6 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-sm text-gray-500 mb-2">{stat.label}</p>
            <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-medium mb-4">最近活动</h3>
        <p className="text-gray-500">暂无活动记录</p>
      </div>
    </div>
  );
}
