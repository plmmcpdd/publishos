import { useEffect, useState, Component, ReactNode, useCallback } from 'react';
import {
  api,
  sendToTikTok,
  refreshPublishStatus,
  retryTikTok,
  fetchDeliveredContents,
  fetchContentDetail,
  ContentItem,
  DeliveryState,
} from '../api';

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

function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  const base = import.meta.env.VITE_API_URL || api.base || 'http://localhost:3000';
  const serverBase = base.replace('/v1', '');
  return `${serverBase}${url.startsWith('/') ? '' : '/'}${url}`;
}

function MediaFallback() {
  return (
    <div className="empty-state" style={{ minHeight: 120, margin: '14px 0' }}>
      <div className="empty-state-title">Preview unavailable</div>
      <div className="empty-state-sub">The media file could not be loaded.</div>
    </div>
  );
}

function DeliveryStateBadge({ state }: { state?: DeliveryState }) {
  if (!state) return null;
  const config: Record<DeliveryState, { label: string; className: string }> = {
    ready_to_review: { label: 'Ready to Review', className: 'status-approved' },
    ready_to_send: { label: 'Ready to Send', className: 'status-approved' },
    send_requested: { label: 'Send Requested', className: 'status-approved' },
    tiktok_initializing: { label: 'Initializing...', className: 'status-approved' },
    uploading_video: { label: 'Uploading Video', className: 'status-approved' },
    tiktok_processing: { label: 'TikTok Processing', className: 'status-approved' },
    sent_to_tiktok: { label: 'Sent to TikTok', className: 'status-published' },
    waiting_for_final_tiktok_publish: { label: 'Open TikTok to Finish', className: 'status-published' },
    published: { label: 'Published', className: 'status-published' },
    failed: { label: 'Failed', className: 'status-rejected' },
    cancelled: { label: 'Cancelled', className: 'status-rejected' },
  };
  const { label, className } = config[state] || { label: state, className: 'status-approved' };
  return <span className={`status-badge ${className}`}>{label}</span>;
}

function isActionable(state?: DeliveryState): boolean {
  return state === 'ready_to_review' || state === 'ready_to_send' || state === 'failed';
}

function isActiveDelivery(state?: DeliveryState): boolean {
  return state === 'send_requested' || state === 'tiktok_initializing' || state === 'uploading_video' || state === 'tiktok_processing' || state === 'sent_to_tiktok' || state === 'waiting_for_final_tiktok_publish';
}

export default function QueueScreen() {
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failedMedia, setFailedMedia] = useState<Record<string, true>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [aiConfirmations, setAiConfirmations] = useState<Record<string, boolean>>({});

  const loadContents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setContents(await fetchDeliveredContents());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadContents(); }, [loadContents]);

  const handleSendToTikTok = async (content: ContentItem) => {
    if (!content.targetAccountBinding) { setError('This content has no target TikTok account. Ask your operator to assign one.'); return; }
    if (!content.targetAccountBinding.active || content.targetAccountBinding.status !== 'active' || content.targetAccountBinding.reauthorizationRequired) { setError('The target TikTok account requires reconnection before sending.'); return; }
    const needsAiAck = Boolean(content.aiDisclosure?.required);
    if (needsAiAck && !aiConfirmations[content.id]) {
      setError('Please confirm the AI-generated content disclosure before sending.');
      return;
    }

    setSendingId(content.id);
    setError('');
    try {
      const result = await sendToTikTok(content.id, {
        contentConfirmed: true,
        aiDisclosureAcknowledged: needsAiAck ? true : undefined,
        accountBindingId: content.targetAccountBinding.id,
      });
      // Refresh the item from backend instead of removing it
      const refreshed = await fetchContentDetail(content.id);
      setContents((prev) => prev.map((c) => (c.id === content.id ? refreshed : c)));
      if (result.message) {
        // Brief success notice will be shown via delivery state
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send to TikTok');
    } finally {
      setSendingId(null);
    }
  };

  const handleRefresh = async (contentId: string) => {
    try {
      await refreshPublishStatus(contentId);
      const refreshed = await fetchContentDetail(contentId);
      setContents((prev) => prev.map((c) => (c.id === contentId ? refreshed : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh status');
    }
  };

  const handleRetry = async (contentId: string) => {
    setSendingId(contentId);
    setError('');
    try {
      await retryTikTok(contentId);
      const refreshed = await fetchContentDetail(contentId);
      setContents((prev) => prev.map((c) => (c.id === contentId ? refreshed : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry');
    } finally {
      setSendingId(null);
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
        <h2>Ready To Review &amp; Send</h2>
        <p>Review content prepared by your operator, then send to TikTok.</p>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="queue-list">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-title">Loading...</div>
          </div>
        ) : contents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">All caught up</div>
            <div className="empty-state-sub">No new content to review right now.</div>
          </div>
        ) : (
          contents.map((content) => {
            const state = content.deliveryState;
            const needsAiAck = Boolean(content.aiDisclosure?.required);
            const isSending = sendingId === content.id;
            const canRetry = content.canRetry && state === 'failed';
            const targetAvailable = Boolean(content.targetAccountBinding && content.targetAccountBinding.active && content.targetAccountBinding.status === 'active' && !content.targetAccountBinding.reauthorizationRequired);

            return (
              <div key={content.id} className="card">
                <div className="card-header">
                  <div className="thumb">
                    {content.thumbnailUrl && resolveMediaUrl(content.thumbnailUrl) ? (
                      <img
                        src={resolveMediaUrl(content.thumbnailUrl) || undefined}
                        alt={content.title}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
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
                      <DeliveryStateBadge state={state} />
                    </div>
                    <div className="card-schedule">Target TikTok Account: {content.targetAccountBinding ? `@${content.targetAccountBinding.username || content.targetAccountBinding.accountUsername || 'TikTok'}` : 'Not assigned'}</div>
                  </div>
                </div>

                {/* Final Caption */}
                {content.finalCaption && (
                  <div style={{ margin: '10px 0', padding: '8px 12px', background: '#f9fafb', borderRadius: 8, fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, color: '#374151' }}>Caption</div>
                    <div style={{ whiteSpace: 'pre-wrap', color: '#4b5563' }}>{content.finalCaption}</div>
                  </div>
                )}

                {/* Hashtags */}
                {content.hashtags && content.hashtags.length > 0 && (
                  <div style={{ margin: '6px 0', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {content.hashtags.map((tag) => (
                      <span key={tag} style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{tag}</span>
                    ))}
                  </div>
                )}

                {/* AI Disclosure */}
                {content.aiDisclosure?.required && (
                  <div style={{ margin: '8px 0', padding: '8px 12px', background: '#fef3c7', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>AI-Generated Content</div>
                    <div>{content.aiDisclosure.instruction}</div>
                    {needsAiAck && isActionable(state) && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, cursor: 'pointer', fontSize: 13, color: '#1f2937' }}>
                        <input
                          type="checkbox"
                          checked={!!aiConfirmations[content.id]}
                          onChange={(e) => setAiConfirmations((prev) => ({ ...prev, [content.id]: e.target.checked }))}
                        />
                        I understand I need to enable the AI-generated content label in TikTok before posting
                      </label>
                    )}
                  </div>
                )}

                {/* Delivery Message */}
                {content.deliveryMessage && isActiveDelivery(state) && (
                  <div style={{ margin: '8px 0', padding: '8px 12px', background: '#eff6ff', borderRadius: 8, fontSize: 13, color: '#1e40af' }}>
                    {content.deliveryMessage}
                  </div>
                )}

                {/* Error */}
                {state === 'failed' && content.publishError && (
                  <div style={{ margin: '8px 0', padding: '8px 12px', background: '#fef2f2', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>
                    {content.publishError}
                  </div>
                )}

                {/* Video preview */}
                {content.videoUrl ? (
                  <div style={{ margin: '14px 0' }}>
                    <ErrorBoundary>
                      {(() => {
                        const src = resolveMediaUrl(content.videoUrl);
                        return src ? (
                          <video
                            controls
                            src={src}
                            style={{ width: '100%', maxHeight: 260, borderRadius: 12, display: failedMedia[content.id] ? 'none' : 'block' }}
                            onError={(e) => {
                              (e.target as HTMLVideoElement).style.display = 'none';
                              setFailedMedia((prev) => ({ ...prev, [content.id]: true }));
                            }}
                          />
                        ) : null;
                      })()}
                    </ErrorBoundary>
                    {failedMedia[content.id] && <MediaFallback />}
                  </div>
                ) : content.thumbnailUrl ? (
                  (() => {
                    const src = resolveMediaUrl(content.thumbnailUrl);
                    return src ? (
                      <img
                        src={src}
                        alt={content.title}
                        style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12, margin: '14px 0' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : null;
                  })()
                ) : null}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  {isActionable(state) && (
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1 }}
                      disabled={isSending || !targetAvailable}
                      onClick={() => void handleSendToTikTok(content)}
                    >
                      {isSending ? 'Sending...' : !content.targetAccountBinding ? 'Target account required' : !targetAvailable ? 'Target account reconnect required' : 'Send to TikTok'}
                    </button>
                  )}
                  {isActiveDelivery(state) && (
                    <button
                      className="btn btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => void handleRefresh(content.id)}
                    >
                      Refresh Status
                    </button>
                  )}
                  {canRetry && (
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1 }}
                      disabled={isSending}
                      onClick={() => void handleRetry(content.id)}
                    >
                      {isSending ? 'Retrying...' : 'Retry'}
                    </button>
                  )}
                  {state === 'waiting_for_final_tiktok_publish' && (
                    <button
                      className="btn btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        // Try to open TikTok app
                        window.open('https://www.tiktok.com', '_blank');
                      }}
                    >
                      Open TikTok
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
    </ErrorBoundary>
  );
}
