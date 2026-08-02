import { useEffect, useState } from 'react';
import { approveContent, createContent, deleteContent, deliverContent, fetchClients, fetchContents, fetchTikTokBindings, firstPlatform, uploadVideo } from '../api';
import type { Client, ContentItem, SocialBinding } from '../api';

const emptyContent = {
  title: '',
  description: '',
  videoUrl: '',
  thumbnailUrl: '',
  platform: 'tiktok',
  clientId: '',
  targetAccountBindingId: '',
};

const statusClass: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  delivered: 'bg-blue-100 text-blue-800',
  published: 'bg-green-100 text-green-800',
  pending_review: 'bg-orange-100 text-orange-800',
  approved: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-800',
};

const statusLabel: Record<string, string> = {
  draft: '草稿',
  delivered: '已推送',
  published: '已发布',
  pending_review: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  failed: '失败',
};

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function bindingCanTargetTikTok(binding: SocialBinding) {
  return binding.active && binding.status === 'active' && !binding.reauthorizationRequired
    && Boolean(binding.grantedScopes?.includes('video.upload'));
}

export default function ContentList() {
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newContent, setNewContent] = useState(emptyContent);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bindings, setBindings] = useState<SocialBinding[]>([]);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadContents = async () => {
    setLoading(true);
    setError('');
    try {
      setContents(await fetchContents());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    setClients(await fetchClients());
  };

  useEffect(() => {
    void loadContents();
    void loadClients();
  }, []);

  const handleCreate = async () => {
    if (!newContent.title || !newContent.description || !newContent.clientId) {
      setError('标题、描述和客户必填');
      return;
    }

    if (newContent.platform === 'tiktok' && !newContent.targetAccountBindingId) { setError('请选择目标 TikTok 账号'); return; }
    if (newContent.platform === 'tiktok' && !bindings.some((binding) => binding.id === newContent.targetAccountBindingId && bindingCanTargetTikTok(binding))) { setError('请选择有效的 TikTok 目标账号'); return; }
    try { setActionId('create'); await createContent(newContent); setShowCreate(false); setNewContent(emptyContent); setBindings([]); await loadContents(); }
    catch (err) { setError(err instanceof Error ? err.message : '创建失败'); } finally { setActionId(null); }
  };

  const handleDeliver = async (id: string) => {
    try { setActionId(id); setError(''); await deliverContent(id); await loadContents(); } catch (err) { setError(err instanceof Error ? err.message : '推送失败'); } finally { setActionId(null); }
  };
  const handleApprove = async (id: string) => { try { setActionId(id); setError(''); await approveContent(id); await loadContents(); } catch (err) { setError(err instanceof Error ? err.message : '审核失败'); } finally { setActionId(null); } };
  const changeClient = async (clientId: string) => { setNewContent((value) => ({ ...value, clientId, targetAccountBindingId: '' })); setBindings([]); if (clientId && newContent.platform === 'tiktok') { try { setBindings(await fetchTikTokBindings(clientId)); } catch (err) { setError(err instanceof Error ? err.message : '无法加载 TikTok 账号'); } } };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该内容？')) return;
    await deleteContent(id);
    await loadContents();
  };

  const handleVideoUpload = async (file?: File) => {
    if (!file) return;
    try {
      const uploaded = await uploadVideo(file);
      setNewContent((value) => ({ ...value, videoUrl: uploaded.storage_key }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    }
  };

  const filtered = filter === 'all' ? contents : contents.filter((content) => content.status === filter);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium">内容管理</h3>
        <button onClick={() => setShowCreate((value) => !value)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg">
          + 创建内容
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {showCreate && (
        <div className="bg-gray-50 rounded-lg p-6 mb-6 border border-gray-200">
          <h4 className="text-lg font-semibold mb-4">新建内容</h4>
          <div className="grid grid-cols-2 gap-4">
            <input
              placeholder="标题"
              value={newContent.title}
              onChange={(event) => setNewContent({ ...newContent, title: event.target.value })}
              className="border rounded px-3 py-2"
            />
            <select
              value={newContent.platform}
              onChange={(event) => { const platform = event.target.value; setNewContent({ ...newContent, platform, targetAccountBindingId: '' }); if (platform === 'tiktok' && newContent.clientId) void fetchTikTokBindings(newContent.clientId).then(setBindings).catch(() => setBindings([])); }}
              className="border rounded px-3 py-2"
            >
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
            </select>
            <textarea
              placeholder="描述"
              value={newContent.description}
              onChange={(event) => setNewContent({ ...newContent, description: event.target.value })}
              className="border rounded px-3 py-2 col-span-2"
              rows={3}
            />
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">视频</label>
              <div className="flex gap-3">
                <input
                  placeholder="视频 URL"
                  value={newContent.videoUrl}
                  onChange={(event) => setNewContent({ ...newContent, videoUrl: event.target.value })}
                  className="border rounded px-3 py-2 flex-1"
                />
                <span className="self-center text-gray-400">或</span>
                <label className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded cursor-pointer text-sm self-center">
                  上传
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(event) => void handleVideoUpload(event.target.files?.[0])}
                  />
                </label>
              </div>
            </div>
            <input
              placeholder="缩略图 URL"
              value={newContent.thumbnailUrl}
              onChange={(event) => setNewContent({ ...newContent, thumbnailUrl: event.target.value })}
              className="border rounded px-3 py-2"
            />
            <select
              value={newContent.clientId}
              onChange={(event) => void changeClient(event.target.value)}
              className="border rounded px-3 py-2 col-span-2"
            >
              <option value="">选择客户</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
            {newContent.platform === 'tiktok' && newContent.clientId && (
              <select value={newContent.targetAccountBindingId} onChange={(event) => setNewContent({ ...newContent, targetAccountBindingId: event.target.value })} className="border rounded px-3 py-2 col-span-2" required>
                <option value="">选择目标 TikTok 账号</option>
                {bindings.map((binding) => <option key={binding.id} value={binding.id} disabled={!bindingCanTargetTikTok(binding)}>{`@${binding.username || binding.accountUsername || 'TikTok'} · ${binding.reauthorizationRequired ? 'Reconnect required' : !binding.grantedScopes?.includes('video.upload') ? 'video.upload required' : 'Connected'}`}</option>)}
              </select>
            )}
            {newContent.platform === 'tiktok' && newContent.clientId && bindings.length === 0 && <p className="text-sm text-red-600 col-span-2">该客户没有有效 TikTok 账号，请先在客户端连接账号。</p>}
          </div>
          <div className="flex gap-3 mt-4">
            <button disabled={actionId === 'create'} onClick={() => void handleCreate()} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg disabled:opacity-50">
              {actionId === 'create' ? '创建中...' : '创建草稿'}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-300 hover:bg-gray-400 rounded-lg">
              取消
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {[
          { key: 'all', label: '全部' },
          { key: 'draft', label: '草稿' },
          { key: 'delivered', label: '已推送' },
          { key: 'published', label: '已发布' },
          { key: 'pending_review', label: '待审核' },
          { key: 'approved', label: '已通过' },
          { key: 'rejected', label: '已拒绝' },
          { key: 'failed', label: '失败' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setFilter(item.key)}
            className={`px-3 py-1 rounded text-sm ${filter === item.key ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">暂无内容</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((content) => (
            <div key={content.id} className="bg-white rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h4 className="font-medium">{content.title}</h4>
                    <span className={`px-2 py-0.5 rounded text-xs ${statusClass[content.status] || 'bg-gray-100 text-gray-700'}`}>
                      {statusLabel[content.status] || content.status}
                    </span>
                    <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{firstPlatform(content).toUpperCase()}</span>
                  </div>
                  {content.description && <p className="text-gray-500 text-sm mt-1">{content.description}</p>}
                  {content.client && <p className="text-gray-500 text-sm mt-1">客户：{content.client.name}</p>}
                  <p className="text-gray-500 text-sm mt-1">目标账号：{content.targetAccountBinding ? `@${content.targetAccountBinding.username || content.targetAccountBinding.accountUsername}` : '未指定'}</p>
                  <p className="text-gray-400 text-xs mt-1">创建时间：{formatDate(content.createdAt)}</p>
                </div>
                <div className="flex gap-2">
                  {content.status === 'draft' && (
                    <button disabled={actionId === content.id} onClick={() => void handleApprove(content.id)} className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm disabled:opacity-50">
                      {actionId === content.id ? '处理中...' : '提交审核'}
                    </button>
                  )}
                  {content.status === 'pending_review' && <button disabled={actionId === content.id} onClick={() => void handleApprove(content.id)} className="px-3 py-1 bg-amber-600 text-white rounded text-sm disabled:opacity-50">批准</button>}
                  {content.status === 'approved' && <button disabled={actionId === content.id} onClick={() => void handleDeliver(content.id)} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm disabled:opacity-50">{actionId === content.id ? '推送中...' : '推送给客户'}</button>}
                  <button onClick={() => void handleDelete(content.id)} className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-sm">
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
