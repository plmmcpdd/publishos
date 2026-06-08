import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContentItem, fetchContents } from '../api';

export default function HistoryScreen() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<ContentItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    <div>
      <div className="screen-header">
        <h2>{t('history.title')}</h2>
        <p>{t('history.summary', { count: history.length })}</p>
      </div>

      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">{t('common.allPlatforms')}</option>
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
        </select>
      </div>

      {loading && <div className="card">{t('common.loading')}</div>}
      {error && <div className="card error-state">{error}</div>}
      {!loading && !error && filtered.length === 0 && <div className="card">{t('common.empty')}</div>}

      <div className="history-list">
        {filtered.map((item) => (
          <div key={item.id} className="history-item card">
            <div className="history-item-main">
              <div className="platform-icon">{item.platform.slice(0, 1).toUpperCase()}</div>
              <div className="history-item-info">
                <h4>{item.title}</h4>
                <span className="meta">{item.scheduledAt || '-'}</span>
              </div>
              <span className={`status-badge status-${item.status}`}>{t(`status.${item.status}`, item.status)}</span>
            </div>
            {item.postUrl && (
              <div className="history-item-url">
                <a href={item.postUrl} target="_blank" rel="noopener noreferrer">{t('history.viewOn', { platform: item.platform })}</a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
