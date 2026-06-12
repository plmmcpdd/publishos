import { useEffect, useState } from 'react';
import { ContentItem, fetchClientHistory } from '../api';

function formatDate(value?: string) {
  if (!value) return '';
  return new Date(value).toLocaleString();
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

function StatusBadge({ status }: { status: string }) {
  const label = status === 'published' ? 'Published' : 'Rejected';
  return <span className={`status-badge ${status === 'published' ? 'status-published' : 'status-rejected'}`}>{label}</span>;
}

export default function HistoryScreen() {
  const [history, setHistory] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      setError('');
      try {
        setHistory(await fetchClientHistory());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setLoading(false);
      }
    }

    void loadHistory();
  }, []);

  return (
    <div className="content-area">
      <div className="topbar">
        <div className="topbar-title">History</div>
        <div className="topbar-badge">
          <span className="status-dot online" />
          Connected
        </div>
      </div>

      <div className="screen-header">
        <h2>Publish History</h2>
        <p>{history.length} completed items</p>
      </div>

      <div className="queue-list">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-title">Loading...</div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-title">{error}</div>
          </div>
        ) : history.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No history yet</div>
            <div className="empty-state-sub">Published or rejected content will appear here.</div>
          </div>
        ) : (
          history.map((item) => (
            <div key={item.id} className="card">
              <div className="card-header">
                <div className="thumb">
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt={item.title} />
                  ) : item.status === 'published' ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </div>
                <div className="card-meta">
                  <div className="card-title">{item.title}</div>
                  <div className="card-schedule">{formatDate(item.updatedAt || item.createdAt)}</div>
                  <div className="tag-row">
                    <PlatformTag platform={item.platform} />
                    <StatusBadge status={item.status} />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
