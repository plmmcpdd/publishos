import { useEffect, useState } from 'react';
import { confirmContent, ContentItem, fetchDeliveredContents } from '../api';

const CURRENT_CLIENT_ID = 'demo-client-1';

function formatDate(value?: string) {
  if (!value) return '';
  return new Date(value).toLocaleDateString();
}

function PlatformTag({ platform }: { platform: string }) {
  const labels: Record<string, string> = {
    tiktok: 'TikTok',
    instagram: 'Instagram',
    youtube: 'YouTube',
    facebook: 'Facebook',
  };
  return <span className="tag tag-tiktok">{labels[platform] || platform}</span>;
}

export default function QueueScreen() {
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadContents = async () => {
    setLoading(true);
    setError('');
    try {
      setContents(await fetchDeliveredContents(CURRENT_CLIENT_ID));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContents();
  }, []);

  const handlePublish = async (contentId: string) => {
    try {
      await confirmContent(contentId);
      setContents((prev) => prev.filter((content) => content.id !== contentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish content');
    }
  };

  return (
    <div className="content-area">
      <div className="topbar">
        <div className="topbar-title">Content Queue</div>
        <div className="topbar-badge">
          <span className="status-dot online" />
          Connected
        </div>
      </div>

      <div className="screen-header">
        <h2>Ready To Publish</h2>
        <p>Review and publish content prepared by your operator.</p>
      </div>

      <div className="section-label">Delivered Content</div>

      <div className="queue-list">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-title">Loading...</div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-title">{error}</div>
          </div>
        ) : contents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">All caught up</div>
            <div className="empty-state-sub">No new content to review right now.</div>
          </div>
        ) : (
          contents.map((content) => (
            <div key={content.id} className="card">
              <div className="card-header">
                <div className="thumb">
                  {content.thumbnailUrl ? (
                    <img src={content.thumbnailUrl} alt={content.title} />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </div>
                <div className="card-meta">
                  <div className="card-title">{content.title}</div>
                  {content.description && <div className="card-schedule">{content.description}</div>}
                  <div className="tag-row">
                    <PlatformTag platform={content.platform} />
                    <span className="tag">{formatDate(content.createdAt || content.updatedAt)}</span>
                    <span className="status-badge status-approved">Delivered</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void handlePublish(content.id)}>
                  Confirm Publish
                </button>
                <button className="btn btn-secondary" style={{ flex: 1 }}>
                  Preview
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
