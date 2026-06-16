import { useEffect, useMemo, useState } from 'react';
import {
  fetchClients,
  fetchMetricsOverview,
  fetchTopMetrics,
  triggerMetricsCollection,
  type Client,
  type MetricsOverview,
  type TopMetric,
} from '../api';

const emptyOverview: MetricsOverview = {
  totalViews: 0,
  totalLikes: 0,
  totalComments: 0,
  totalShares: 0,
  totalSaves: 0,
  totalReach: 0,
  totalImpressions: 0,
  avgEngagementRate: 0,
  byPlatform: {},
  dataPoints: 0,
  period: '30 days',
};

function formatNumber(value: number): string {
  return value.toLocaleString();
}

export default function Analytics() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<MetricsOverview>(emptyOverview);
  const [topMetrics, setTopMetrics] = useState<TopMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState('');
  const selectedClient = useMemo(() => clients.find((client) => client.id === clientId), [clients, clientId]);

  useEffect(() => {
    fetchClients()
      .then((items) => {
        setClients(items);
        if (items[0]) setClientId(items[0].id);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load clients'));
  }, []);

  useEffect(() => {
    if (!clientId) return;

    setLoading(true);
    setError('');
    Promise.all([fetchMetricsOverview(clientId, days), fetchTopMetrics(clientId)])
      .then(([overviewData, topData]) => {
        setOverview(overviewData);
        setTopMetrics(topData);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [clientId, days]);

  const runCollection = async () => {
    setCollecting(true);
    setError('');
    try {
      await triggerMetricsCollection();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start collection');
    } finally {
      setCollecting(false);
    }
  };

  const cards = [
    { label: 'Total Views', value: formatNumber(overview.totalViews), color: 'text-blue-600' },
    { label: 'Total Likes', value: formatNumber(overview.totalLikes), color: 'text-rose-600' },
    { label: 'Comments', value: formatNumber(overview.totalComments), color: 'text-emerald-600' },
    { label: 'Avg Engagement', value: `${overview.avgEngagementRate.toFixed(2)}%`, color: 'text-violet-600' },
  ];

  return (
    <div>
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
        <button
          type="button"
          onClick={runCollection}
          disabled={collecting}
          className="rounded-lg bg-brand-deepblue px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {collecting ? 'Collection started' : 'Collect now'}
        </button>
      </div>

      <div className="mb-6">
        <p className="text-sm text-gray-500">{selectedClient ? selectedClient.name : 'No client selected'}</p>
        <h1 className="text-2xl font-semibold text-gray-900">Performance Analytics</h1>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg bg-white p-5 shadow-sm">
            <p className="mb-2 text-sm text-gray-500">{card.label}</p>
            <p className={`text-3xl font-bold ${card.color}`}>{loading ? '-' : card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium">By Platform</h2>
            <span className="text-sm text-gray-500">{overview.dataPoints} data points</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {Object.entries(overview.byPlatform).map(([platform, data]) => (
              <div key={platform} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="mb-3 font-medium capitalize">{platform}</p>
                <p className="text-sm text-gray-600">Views: {formatNumber(data.views)}</p>
                <p className="text-sm text-gray-600">Likes: {formatNumber(data.likes)}</p>
                <p className="text-sm text-gray-600">Comments: {formatNumber(data.comments)}</p>
                <p className="text-sm text-gray-600">Shares: {formatNumber(data.shares)}</p>
              </div>
            ))}
            {!loading && Object.keys(overview.byPlatform).length === 0 && (
              <p className="text-sm text-gray-500">No performance data has been collected for this client yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-medium">Top Content</h2>
          <div className="space-y-3">
            {topMetrics.map((metric) => (
              <div key={metric.id} className="rounded-lg border border-gray-200 p-3">
                <p className="font-medium text-gray-900">{metric.content?.title || metric.contentId}</p>
                <p className="text-sm capitalize text-gray-500">{metric.platform}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-600">
                  <span>{formatNumber(metric.views)} views</span>
                  <span>{formatNumber(metric.likes)} likes</span>
                </div>
              </div>
            ))}
            {!loading && topMetrics.length === 0 && <p className="text-sm text-gray-500">No ranked content yet.</p>}
          </div>
        </section>
      </div>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Delivery and paid promotion suggestions are for reference only and do not guarantee advertising outcomes. Budget
        allocation and campaign decisions remain the client's responsibility.
      </div>
    </div>
  );
}
