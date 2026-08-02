export default function Monitor() {
  const checks = [
    { label: 'API 网关', status: '正常', detail: '同源 /v1' },
    { label: '内容队列', status: '运行中', detail: '使用本地 SQLite 数据库' },
    { label: '审计日志', status: '已启用', detail: '记录审核与发布动作' },
  ];

  return (
    <div>
      <h3 className="text-lg font-medium mb-4">系统监控</h3>
      <div className="grid grid-cols-3 gap-6">
        {checks.map((item) => (
          <div key={item.label} className="bg-white rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium">{item.label}</p>
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">{item.status}</span>
            </div>
            <p className="text-sm text-gray-500">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
