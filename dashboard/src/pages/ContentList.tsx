import { useEffect, useState } from 'react';
import { createContent, deleteContent, deliverContent, fetchClients, fetchContents, firstPlatform } from '../api';
import type { Client, ContentItem } from '../api';

const emptyContent = {
  title: '',
  description: '',
  videoUrl: '',
  thumbnailUrl: '',
  platform: 'tiktok',
  clientId: '',
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

function formatStatus(status: string) {
  return status.replace('_', ' ');
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export default function ContentList() {
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newContent, setNewContent] = useState(emptyContent);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

    await createContent(newContent);
    setShowCreate(false);
    setNewContent(emptyContent);
    await loadContents();
  };

  const handleDeliver = async (id: string) => {
    await deliverContent(id);
    await loadContents();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this content?')) return;
    await deleteContent(id);
    await loadContents();
  };

  const filtered = filter === 'all' ? contents : contents.filter((content) => content.status === filter);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium">Content Manager</h3>
        <button onClick={() => setShowCreate((value) => !value)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg">
          + Create Content
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {showCreate && (
        <div className="bg-gray-50 rounded-lg p-6 mb-6 border border-gray-200">
          <h4 className="text-lg font-semibold mb-4">New Content</h4>
          <div className="grid grid-cols-2 gap-4">
            <input
              placeholder="Title"
              value={newContent.title}
              onChange={(event) => setNewContent({ ...newContent, title: event.target.value })}
              className="border rounded px-3 py-2"
            />
            <select
              value={newContent.platform}
              onChange={(event) => setNewContent({ ...newContent, platform: event.target.value })}
              className="border rounded px-3 py-2"
            >
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
            </select>
            <textarea
              placeholder="Description"
              value={newContent.description}
              onChange={(event) => setNewContent({ ...newContent, description: event.target.value })}
              className="border rounded px-3 py-2 col-span-2"
              rows={3}
            />
            <input
              placeholder="Video URL"
              value={newContent.videoUrl}
              onChange={(event) => setNewContent({ ...newContent, videoUrl: event.target.value })}
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="Thumbnail URL"
              value={newContent.thumbnailUrl}
              onChange={(event) => setNewContent({ ...newContent, thumbnailUrl: event.target.value })}
              className="border rounded px-3 py-2"
            />
            <select
              value={newContent.clientId}
              onChange={(event) => setNewContent({ ...newContent, clientId: event.target.value })}
              className="border rounded px-3 py-2 col-span-2"
            >
              <option value="">Select Client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => void handleCreate()} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg">
              Create Draft
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-300 hover:bg-gray-400 rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {['all', 'draft', 'delivered', 'published', 'pending_review', 'approved', 'rejected', 'failed'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-1 rounded text-sm ${filter === status ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            {status === 'all' ? 'All' : formatStatus(status)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">No content found</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((content) => (
            <div key={content.id} className="bg-white rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h4 className="font-medium">{content.title}</h4>
                    <span className={`px-2 py-0.5 rounded text-xs ${statusClass[content.status] || 'bg-gray-100 text-gray-700'}`}>
                      {formatStatus(content.status)}
                    </span>
                    <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{firstPlatform(content).toUpperCase()}</span>
                  </div>
                  {content.description && <p className="text-gray-500 text-sm mt-1">{content.description}</p>}
                  {content.client && <p className="text-gray-500 text-sm mt-1">Client: {content.client.name}</p>}
                  <p className="text-gray-400 text-xs mt-1">Created: {formatDate(content.createdAt)}</p>
                </div>
                <div className="flex gap-2">
                  {content.status === 'draft' && (
                    <button onClick={() => void handleDeliver(content.id)} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm">
                      Deliver
                    </button>
                  )}
                  <button onClick={() => void handleDelete(content.id)} className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-sm">
                    Delete
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
