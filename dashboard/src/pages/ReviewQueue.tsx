import { useState } from 'react';

const mockContents = [
  { id: 1, title: 'HVAC Summer Tips', platform: 'TikTok', status: 'pending', createdAt: '2026-06-08' },
  { id: 2, title: 'AC Maintenance Guide', platform: 'TikTok', status: 'pending', createdAt: '2026-06-08' },
];

export default function ReviewQueue() {
  const [contents, setContents] = useState(mockContents);

  const handleApprove = (id: number) => {
    setContents((prev) => prev.filter((content) => content.id !== id));
    alert(`内容 #${id} 已通过`);
  };

  const handleReject = (id: number) => {
    setContents((prev) => prev.filter((content) => content.id !== id));
    alert(`内容 #${id} 已拒绝`);
  };

  return (
    <div>
      <h3 className="text-lg font-medium mb-4">待审核内容 ({contents.length})</h3>
      {contents.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">暂无待审核内容</div>
      ) : (
        <div className="space-y-4">
          {contents.map((content) => (
            <div key={content.id} className="bg-white rounded-xl p-6 shadow-sm flex items-center justify-between">
              <div>
                <h4 className="font-medium">{content.title}</h4>
                <p className="text-sm text-gray-500 mt-1">
                  {content.platform} · {content.createdAt}
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => handleApprove(content.id)} className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
                  通过
                </button>
                <button onClick={() => handleReject(content.id)} className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">
                  拒绝
                </button>
                <button className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">查看</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
