import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContentItem, fetchContents, publishContent } from '../api';

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
    pending: 'status-pending',
    pending_review: 'status-pending',
    approved: 'status-approved',
    publishing: 'status-approved',
    published: 'status-published',
    failed: 'status-failed',
  };
  const labels: Record<string, string> = {
    pending: 'Pending',
    pending_review: 'Queued',
    approved: 'Approved',
    publishing: 'Publishing',
    published: 'Published',
    failed: 'Failed',
  };
  return <span className={`status-badge ${map[status] || 'status-pending'}`}>{labels[status] || status}</span>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <div className="toggle-knob" />
    </div>
  );
}

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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('queue.publishFailed'));
    }
  };

  return (
    <div className="content-area">
      {/* Top Bar */}
      <div className="topbar">
        <div className="topbar-title">{t('queue.title')}</div>
        <div className="topbar-badge">
          <span className="status-dot online" />
          {t('common.connected')}
        </div>
      </div>

      {/* Screen Header */}
      <div className="screen-header">
        <h2>{t('queue.heading')}</h2>
        <p>
          {jobs.length} {t('queue.jobsPending')} — {t('queue.autoPublish')} {autoPublish ? t('common.on') : t('common.off')}
        </p>
      </div>

      {/* Auto-publish toggle bar */}
      <div className="auto-publish-bar">
        <div>
          <strong>{t('queue.autoPublish')}</strong>
          <span>{t('queue.autoPublishDesc')}</span>
        </div>
        <Toggle checked={autoPublish} onChange={setAutoPublish} />
      </div>

      {/* Section label */}
      <div className="section-label">{t('queue.upcoming')}</div>

      {/* Job list */}
      <div className="queue-list">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-title">{t('common.loading')}</div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-title">{error}</div>
          </div>
        ) : jobs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">{t('queue.emptyTitle')}</div>
            <div className="empty-state-sub">{t('queue.emptySub')}</div>
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="card">
              <div className="card-header">
                <div className="thumb">
                  {job.thumbnailUrl ? (
                    <img src={job.thumbnailUrl} alt={job.title} />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </div>
                <div className="card-meta">
                  <div className="card-title">{job.title}</div>
                  <div className="card-schedule">{t('queue.scheduledAt')} {job.scheduledAt}</div>
                  <div className="tag-row">
                    <PlatformTag platform={job.platform} />
                    <StatusBadge status={job.status} />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void handlePublish(job.id)}>
                  {t('queue.publishNow')}
                </button>
                <button className="btn btn-secondary" style={{ flex: 1 }}>
                  {t('queue.preview')}
                </button>
                <button className="btn btn-secondary" style={{ width: 80 }}>
                  {t('queue.skip')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
