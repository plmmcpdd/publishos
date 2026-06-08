import { useState } from 'react';

interface HistoryItem {
  id: string;
  title: string;
  platform: string;
  publishedAt: string;
  status: 'published' | 'failed';
  postUrl?: string;
}

const mockHistory: HistoryItem[] = [
  { id: 'h1', title: 'AC Maintenance Guide', platform: 'tiktok', publishedAt: '2024-06-07 10:00', status: 'published', postUrl: 'https://tiktok.com/@acme/video/123' },
  { id: 'h2', title: 'Water Heater Tips', platform: 'instagram', publishedAt: '2024-06-06 14:00', status: 'published' },
  { id: 'h3', title: 'AI Tool Review', platform: 'tiktok', publishedAt: '2024-06-05 09:00', status: 'failed' },
];

export default function HistoryScreen() {
  const [history] = useState<HistoryItem[]>(mockHistory);
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? history : history.filter((h) => h.platform === filter);

  return (
    <div>
      <div className="screen-header">
        <h2>Publish History</h2>
        <p>{history.length} total posts</p>
      </div>

      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All Platforms</option>
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
        </select>
      </div>

      <div className="history-list">
        {filtered.map((item) => (
          <div key={item.id} className="history-item card">
            <div className="history-item-main">
              <div className="platform-icon">{item.platform === 'tiktok' ? '🎵' : '📷'}</div>
              <div className="history-item-info">
                <h4>{item.title}</h4>
                <span className="meta">{item.publishedAt}</span>
              </div>
              <span className={`status-badge status-${item.status}`}>{item.status}</span>
            </div>
            {item.postUrl && (
              <div className="history-item-url">
                <a href={item.postUrl} target="_blank" rel="noopener noreferrer">View on {item.platform}</a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
