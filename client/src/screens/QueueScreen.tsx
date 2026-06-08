import { useState } from 'react';

interface QueueJob {
  id: string;
  title: string;
  platform: string;
  scheduledAt: string;
  mediaUrl: string;
  status: 'pending' | 'publishing' | 'done';
}

const mockJobs: QueueJob[] = [
  { id: '1', title: 'HVAC Summer Tips', platform: 'tiktok', scheduledAt: '14:00', mediaUrl: 'video1.mp4', status: 'pending' },
  { id: '2', title: 'AI Startup Launch', platform: 'instagram', scheduledAt: '15:30', mediaUrl: 'video2.mp4', status: 'pending' },
  { id: '3', title: 'Plumbing FAQ', platform: 'tiktok', scheduledAt: '17:00', mediaUrl: 'video3.mp4', status: 'pending' },
];

export default function QueueScreen() {
  const [jobs] = useState<QueueJob[]>(mockJobs);
  const [autoPublish, setAutoPublish] = useState(false);

  return (
    <div>
      <div className="screen-header">
        <h2>Publish Queue</h2>
        <p>{jobs.length} jobs pending — Auto-publish is {autoPublish ? 'ON' : 'OFF'}</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <label className="auto-publish-toggle">
          <input
            type="checkbox"
            checked={autoPublish}
            onChange={(e) => setAutoPublish(e.target.checked)}
          />
          <span className="toggle-label">Auto-publish when scheduled time arrives</span>
        </label>
      </div>

      <div className="queue-list">
        {jobs.map((job) => (
          <div key={job.id} className="queue-item card">
            <div className="queue-item-main">
              <div className="platform-icon">{job.platform === 'tiktok' ? '🎵' : '📷'}</div>
              <div className="queue-item-info">
                <h4>{job.title}</h4>
                <span className="meta">{job.platform} • Scheduled {job.scheduledAt}</span>
              </div>
              <span className={`status-badge status-${job.status}`}>{job.status}</span>
            </div>
            <div className="queue-item-actions">
              <button className="btn btn-primary">Publish Now</button>
              <button className="btn btn-secondary">Preview</button>
              <button className="btn btn-secondary">Skip</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
