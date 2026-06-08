import { useEffect, useState } from 'react';
import { fetchContents, firstPlatform } from '../api';
import type { ContentItem } from '../api';

const statusBadge: Record<string, string> = {
  published: 'bg-green-100 text-green-700',
  queued: 'bg-amber-100 text-amber-700',
  approved: 'bg-amber-100 text-amber-700',
  pending_review: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
  rejected: 'bg-red-100 text-red-700',
};

const statusText: Record<string, string> = {
  published: '已发布',
  queued: '队列中',
  approved: '已通过',
  pending_review: '待审核',
  failed: '失败',
  rejected: '已拒绝',
};

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

export default function ContentList() {
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchContents('published,failed,queued,rejected')
      .then(setContents)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

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
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">更新时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  加载中...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-red-500">
                  加载失败：{error}
                </td>
              </tr>
            ) : contents.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  暂无内容
                </td>
              </tr>
            ) : (
              contents.map((content) => (
                <tr key={content.id}>
                  <td className="px-6 py-4 text-sm">{content.id.slice(0, 8)}</td>
                  <td className="px-6 py-4 text-sm font-medium">{content.title}</td>
                  <td className="px-6 py-4 text-sm">{firstPlatform(content)}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge[content.status] || 'bg-gray-100 text-gray-700'}`}>
                      {statusText[content.status] || content.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatDate(content.updatedAt || content.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
