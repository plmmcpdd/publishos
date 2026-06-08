import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContentItem, fetchContents, publishContent } from '../api';

export default function QueueScreen() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<ContentItem[]>([]);
  const [autoPublish, setAutoPublish] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadJobs = async () => {
    setLoading(true);
    setError('');
    try {
      setJobs(await fetchContents('queued'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
  }, []);

  const handlePublish = async (id: string) => {
    try {
      await publishContent(id);
      await loadJobs();
    } catch {
      setError(t('queue.publishFailed'));
    }
  };

  return (
    <div>
      <div className="screen-header">
        <h2>{t('queue.title')}</h2>
        <p>{t('queue.summary', { count: jobs.length, state: autoPublish ? t('queue.autoOn') : t('queue.autoOff') })}</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <label className="auto-publish-toggle">
          <input
            type="checkbox"
            checked={autoPublish}
            onChange={(e) => setAutoPublish(e.target.checked)}
          />
          <span className="toggle-label">{t('queue.autoPublish')}</span>
        </label>
      </div>

      {loading && <div className="card">{t('common.loading')}</div>}
      {error && <div className="card error-state">{error}</div>}
      {!loading && !error && jobs.length === 0 && <div className="card">{t('common.empty')}</div>}

      <div className="queue-list">
        {jobs.map((job) => (
          <div key={job.id} className="queue-item card">
            <div className="queue-item-main">
              <div className="platform-icon">{job.platform.slice(0, 1).toUpperCase()}</div>
              <div className="queue-item-info">
                <h4>{job.title}</h4>
                <span className="meta">{job.platform} - {t('queue.scheduled', { time: job.scheduledAt || '-' })}</span>
              </div>
              <span className={`status-badge status-${job.status}`}>{t(`status.${job.status}`, job.status)}</span>
            </div>
            <div className="queue-item-actions">
              <button className="btn btn-primary" onClick={() => void handlePublish(job.id)}>{t('queue.publishNow')}</button>
              <button className="btn btn-secondary">{t('queue.preview')}</button>
              <button className="btn btn-secondary">{t('queue.skip')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
