import { useEffect, useState } from 'react';
import { approveContent, fetchContents, firstPlatform, rejectContent } from '../api';
import type { ContentItem } from '../api';

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

export default function ReviewQueue() {
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadContents = () => {
    setLoading(true);
    setError('');
    fetchContents('pending')
      .then(setContents)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadContents();
  }, []);

  const handleApprove = async (id: string) => {
    await approveContent(id);
    setContents((prev) => prev.filter((content) => content.id !== id));
  };

  const handleReject = async (id: string) => {
    await rejectContent(id);
    setContents((prev) => prev.filter((content) => content.id !== id));
  };

  return (
    <div>
      <h3 className="text-lg font-medium mb-4">待审核内容 ({contents.length})</h3>
      {loading ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">加载中...</div>
      ) : error ? (
        <div className="bg-white rounded-xl p-8 text-center text-red-500">加载失败：{error}</div>
      ) : contents.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">暂无待审核内容</div>
      ) : (
        <div className="space-y-4">
          {contents.map((content) => (
            <div key={content.id} className="bg-white rounded-xl p-6 shadow-sm flex items-center justify-between">
              <div>
                <h4 className="font-medium">{content.title}</h4>
                <p className="text-sm text-gray-500 mt-1">
                  {firstPlatform(content)} · {formatDate(content.createdAt || content.updatedAt)}
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => void handleApprove(content.id)} className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
                  通过
                </button>
                <button onClick={() => void handleReject(content.id)} className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">
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
