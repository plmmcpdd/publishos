import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContentItem, fetchContents } from '../api';

function formatDate(isoString: string, language: string): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
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
  const { t } = useTranslation();
  const map: Record<string, string> = {
    published: 'status-published',
    failed: 'status-failed',
    rejected: 'status-rejected',
  };
  const key = `status.${status}`;
  const label = t(key);
  return <span className={`status-badge ${map[status] || 'status-published'}`}>{label === key ? status : label}</span>;
}

export default function HistoryScreen() {
  const { i18n, t } = useTranslation();
  const [history, setHistory] = useState<ContentItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const platforms = ['all', 'tiktok', 'instagram', 'youtube', 'facebook'];

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      setError('');
      try {
        setHistory(await fetchContents('published,failed,rejected'));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.error'));
      } finally {
        setLoading(false);
      }
    }

    void loadHistory();
  }, []);

  const filtered = filter === 'all' ? history : history.filter((h) => h.platform === filter);

  return (
    <div className="content-area">
      <div className="topbar">
        <div className="topbar-title">{t('history.title')}</div>
        <div className="topbar-badge">
          <span className="status-dot online" />
          {t('common.connected')}
        </div>
      </div>

      <div className="screen-header">
        <h2>{t('history.heading')}</h2>
        <p>
          {history.length} {t('history.totalPosts')}
        </p>
      </div>

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

      <div className="queue-list">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-title">{t('common.loading')}</div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-title">{error}</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">{t('history.emptyTitle')}</div>
            <div className="empty-state-sub">{t('history.emptySub')}</div>
          </div>
        ) : (
          filtered.map((item) => (
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
                  <div className="card-schedule">{formatDate(item.scheduledAt, i18n.language)}</div>
                  <div className="tag-row">
                    <PlatformTag platform={item.platform} />
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
