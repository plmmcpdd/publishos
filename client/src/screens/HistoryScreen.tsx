import { useEffect, useState, useCallback } from 'react';
import {
  api,
  ContentItem,
  DeliveryState,
  fetchClientHistory,
  fetchContentDetail,
  retryTikTok,
  refreshPublishStatus,
} from '../api';

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

function StatusBadge({ state, status }: { state?: DeliveryState; status: string }) {
  const displayState = state || status;
  const labels: Record<string, string> = {
    published: 'Published',
    rejected: 'Rejected',
    failed: 'Failed',
    ready_to_review: 'Ready to Review',
    ready_to_send: 'Ready to Send',
    send_requested: 'Sending...',
    tiktok_initializing: 'Initializing...',
    uploading_video: 'Uploading...',
    tiktok_processing: 'Processing...',
    sent_to_tiktok: 'Sent to TikTok',
    waiting_for_final_tiktok_publish: 'Waiting for You',
    cancelled: 'Cancelled',
  };
  const className = displayState === 'published' ? 'status-published'
    : displayState === 'failed' ? 'status-rejected'
    : displayState === 'waiting_for_final_tiktok_publish' || displayState === 'sent_to_tiktok' ? 'status-published'
    : 'status-approved';
  return <span className={`status-badge ${className}`}>{labels[displayState] || displayState}</span>;
}

function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  const base = import.meta.env.VITE_API_URL || api.base || 'http://localhost:3000';
  const serverBase = base.replace('/v1', '');
  return `${serverBase}${url.startsWith('/') ? '' : '/'}${url}`;
}

export default function HistoryScreen() {
  const [history, setHistory] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setHistory(await fetchClientHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const handleRetry = async (contentId: string) => {
    setRetryingId(contentId);
    setError('');
    try {
      await retryTikTok(contentId);
      const refreshed = await fetchContentDetail(contentId);
      setHistory((prev) => prev.map((c) => (c.id === contentId ? refreshed : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry');
    } finally {
      setRetryingId(null);
    }
  };

  const handleRefresh = async (contentId: string) => {
    try {
      await refreshPublishStatus(contentId);
      const refreshed = await fetchContentDetail(contentId);
      setHistory((prev) => prev.map((c) => (c.id === contentId ? refreshed : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    }
  };

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
        <h2>Content History</h2>
        <p>{history.length} items</p>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="queue-list">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-title">Loading...</div>
          </div>
        ) : history.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No history yet</div>
            <div className="empty-state-sub">Content will appear here after it is processed.</div>
          </div>
        ) : (
          history.map((item) => {
            const state = item.deliveryState;
            const isActive = state === 'send_requested' || state === 'tiktok_initializing' || state === 'uploading_video' || state === 'tiktok_processing' || state === 'sent_to_tiktok' || state === 'waiting_for_final_tiktok_publish';

            return (
              <div key={item.id} className="card">
                <div className="card-header">
                  <div className="thumb">
                    {item.thumbnailUrl && resolveMediaUrl(item.thumbnailUrl) ? (
                      <img
                        src={resolveMediaUrl(item.thumbnailUrl) || undefined}
                        alt={item.title}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : item.status === 'published' ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    )}
                  </div>
                  <div className="card-meta">
                    <div className="card-title">{item.title}</div>
                    <div className="card-schedule">{formatDate(item.updatedAt || item.createdAt)}</div>

                    {/* Delivery message for active items */}
                    {isActive && item.deliveryMessage && (
                      <div style={{ fontSize: 12, color: '#1e40af', marginTop: 4 }}>
                        {item.deliveryMessage}
                      </div>
                    )}

                    {/* Waiting for customer */}
                    {state === 'waiting_for_final_tiktok_publish' && (
                      <div style={{ fontSize: 12, color: '#92400e', marginTop: 4, fontWeight: 500 }}>
                        Open TikTok on your phone to finish publishing
                      </div>
                    )}

                    {/* Error */}
                    {item.status === 'failed' && item.publishError && (
                      <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4, wordBreak: 'break-word' }}>
                        {item.publishError.length > 120 ? item.publishError.slice(0, 120) + '...' : item.publishError}
                      </div>
                    )}

                    <div className="tag-row">
                      <PlatformTag platform={item.platform} />
                      <StatusBadge state={state} status={item.status} />
                    </div>
                  </div>
                </div>

                {/* Actions for active/failed items */}
                {(isActive || item.canRetry) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    {isActive && (
                      <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => void handleRefresh(item.id)}>
                        Refresh
                      </button>
                    )}
                    {item.canRetry && (
                      <button className="btn btn-primary" style={{ fontSize: 12, padding: '4px 12px' }} disabled={retryingId === item.id} onClick={() => void handleRetry(item.id)}>
                        {retryingId === item.id ? 'Retrying...' : 'Retry'}
                      </button>
                    )}
                    {state === 'waiting_for_final_tiktok_publish' && (
                      <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => window.open('https://www.tiktok.com', '_blank')}>
                        Open TikTok
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
