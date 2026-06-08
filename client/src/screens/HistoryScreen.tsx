import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface HistoryItem {
  id: string;
  title: string;
  platform: 'tiktok' | 'instagram' | 'youtube' | 'facebook';
  publishedAt: string;
  status: 'published' | 'failed';
  postUrl?: string;
  isAiGenerated?: boolean;
}

const mockHistory: HistoryItem[] = [
  {
    id: 'h1',
    title: 'AC Maintenance Guide: Keep Your Cool',
    platform: 'tiktok',
    publishedAt: '2024-06-07 10:00',
    status: 'published',
    postUrl: 'https://tiktok.com/@acme/video/123',
    isAiGenerated: true,
  },
  {
    id: 'h2',
    title: 'Water Heater Tips for Winter',
    platform: 'instagram',
    publishedAt: '2024-06-06 14:00',
    status: 'published',
    isAiGenerated: false,
  },
  {
    id: 'h3',
    title: 'AI Tool Review: ChatGPT vs Claude',
    platform: 'tiktok',
    publishedAt: '2024-06-05 09:00',
    status: 'failed',
    isAiGenerated: true,
  },
];

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
  const map: Record<string, string> = {
    published: 'status-published',
    failed: 'status-failed',
  };
  const labels: Record<string, string> = {
    published: 'Published',
    failed: 'Failed',
  };
  return <span className={`status-badge ${map[status] || 'status-published'}`}>{labels[status] || status}</span>;
}

export default function HistoryScreen() {
  const { t } = useTranslation();
  const [history] = useState<HistoryItem[]>(mockHistory);
  const [filter, setFilter] = useState('all');

  const platforms = ['all', 'tiktok', 'instagram', 'youtube', 'facebook'];

  const filtered = filter === 'all' ? history : history.filter((h) => h.platform === filter);

  return (
    <div className="content-area">
      {/* Top Bar */}
      <div className="topbar">
        <div className="topbar-title">{t('history.title')}</div>
        <div className="topbar-badge">
          <span className="status-dot online" />
          {t('common.connected')}
        </div>
      </div>

      {/* Screen Header */}
      <div className="screen-header">
        <h2>{t('history.heading')}</h2>
        <p>
          {history.length} {t('history.totalPosts')}
        </p>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px', marginBottom: 12, overflowX: 'auto' }}>
        {platforms.map((p) => (
          <button
            key={p}
            className={`tag ${filter === p ? 'tag-tiktok' : ''}`}
            onClick={() => setFilter(p)}
            style={{
              cursor: 'pointer',
              border: filter === p ? '1px solid rgba(30, 64, 175, 0.3)' : '1px solid var(--border)',
              background: filter === p ? 'rgba(30, 64, 175, 0.06)' : 'var(--surface)',
              color: filter === p ? 'var(--accent-primary)' : 'var(--text-secondary)',
            }}
          >
            {p === 'all' ? t('history.filterAll') : p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* History list */}
      <div className="queue-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">{t('history.emptyTitle')}</div>
            <div className="empty-state-sub">{t('history.emptySub')}</div>
          </div>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="card">
              <div className="card-header">
                <div className="thumb">
                  {item.status === 'published' ? (
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
                  <div className="card-schedule">{item.publishedAt}</div>
                  <div className="tag-row">
                    <PlatformTag platform={item.platform} />
                    {item.isAiGenerated && <span className="tag tag-ai">{t('common.aiGenerated')}</span>}
                    <StatusBadge status={item.status} />
                  </div>
                </div>
              </div>
              {item.postUrl && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
                  <a href={item.postUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 500 }}>
                    {t('history.viewOn')} {item.platform} →
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
