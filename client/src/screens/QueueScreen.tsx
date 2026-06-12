import { useEffect, useState, Component, ReactNode } from 'react';
import { api, confirmContent, ContentItem, fetchDeliveredContents } from '../api';

// Error boundary to catch render crashes
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) { return { error: err.message || String(err) }; }
  render() {
    if (this.state.error) return <div className="empty-state"><div className="empty-state-title" style={{ color: '#dc2626' }}>Render error: {this.state.error}</div></div>;
    return this.props.children;
  }
}

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

function assetUrl(value?: string) {
  return resolveMediaUrl(value) || '';
}

function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  const base = import.meta.env.VITE_API_URL || api.base || 'http://localhost:3000';
  const serverBase = base.replace('/v1', '');
  return `${serverBase}${url.startsWith('/') ? '' : '/'}${url}`;
}

export default function QueueScreen() {
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishNotice, setPublishNotice] = useState('');

  const loadContents = async () => {
    setLoading(true);
    setError('');
    try {
      setContents(await fetchDeliveredContents());
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
      const result = await confirmContent(contentId);
      setPublishNotice(
        result.publishing
          ? 'Publishing to TikTok. This may take a few minutes.'
          : result.message || 'Confirmed. No TikTok account connected.',
      );
      alert(
        result.publishing
          ? 'Publishing to TikTok. This may take a few minutes.'
          : 'Confirmed. No TikTok account connected.',
      );
      setContents((prev) => prev.filter((content) => content.id !== contentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish content');
      alert('Failed to publish');
    }
  };

  return (
    <ErrorBoundary>
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
      {publishNotice && <div className="login-error" style={{ color: '#166534', background: '#f0fdf4', borderColor: '#bbf7d0' }}>{publishNotice}</div>}

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
                  {content.thumbnailUrl && resolveMediaUrl(content.thumbnailUrl) ? (
                    <img
                      src={assetUrl(content.thumbnailUrl)}
                      alt={content.title}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
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
              {content.videoUrl ? (
                <div style={{ margin: '14px 0' }}>
                  <ErrorBoundary>
                    {(() => {
                      const src = resolveMediaUrl(content.videoUrl);
                      return src ? (
                        <video
                          controls
                          src={src}
                          style={{ width: '100%', maxHeight: 260, borderRadius: 12 }}
                          onError={(e) => {
                            (e.target as HTMLVideoElement).style.display = 'none';
                          }}
                        />
                      ) : null;
                    })()}
                  </ErrorBoundary>
                </div>
              ) : content.thumbnailUrl ? (
                (() => {
                  const src = resolveMediaUrl(content.thumbnailUrl);
                  return src ? (
                    <img
                      src={src}
                      alt={content.title}
                      style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12, margin: '14px 0' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : null;
                })()
              ) : null}
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
    </ErrorBoundary>
  );
}
