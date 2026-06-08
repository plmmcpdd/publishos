const mockAllContents = [
  { id: 1, title: 'HVAC Summer Tips', platform: 'TikTok', status: 'published', createdAt: '2026-06-08' },
  { id: 2, title: 'AC Maintenance Guide', platform: 'TikTok', status: 'queued', createdAt: '2026-06-08' },
  { id: 3, title: 'Duct Cleaning Demo', platform: 'TikTok', status: 'failed', createdAt: '2026-06-08' },
  { id: 4, title: 'Plumbing FAQ', platform: 'Instagram', status: 'pending', createdAt: '2026-06-08' },
];

const statusBadge: Record<string, string> = {
  published: 'bg-green-100 text-green-700',
  queued: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-blue-100 text-blue-700',
};

const statusText: Record<string, string> = {
  published: '已发布',
  queued: '队列中',
  failed: '失败',
  pending: '待审核',
};

export default function ContentList() {
  return (
    <div>
      <h3 className="text-lg font-medium mb-4">内容管理</h3>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">ID</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">标题</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">平台</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">状态</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">创建时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {mockAllContents.map((content) => (
              <tr key={content.id}>
                <td className="px-6 py-4 text-sm">{content.id}</td>
                <td className="px-6 py-4 text-sm font-medium">{content.title}</td>
                <td className="px-6 py-4 text-sm">{content.platform}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge[content.status]}`}>
                    {statusText[content.status]}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{content.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
