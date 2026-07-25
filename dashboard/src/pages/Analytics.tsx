import { useEffect, useMemo, useState } from 'react';
import {
  fetchClients,
  fetchMetricsOverview,
  fetchTopMetrics,
  fetchTikTokBindings,
  triggerMetricsCollection,
  type Client,
  type MetricsOverview,
  type TopMetric,
  type SocialBinding,
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

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function CollectionStatusBadge({ status }: { status?: string }) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    idle: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Idle' },
    collecting: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Collecting...' },
    success: { bg: 'bg-green-100', text: 'text-green-700', label: 'Success' },
    error: { bg: 'bg-red-100', text: 'text-red-700', label: 'Error' },
  };
  const style = styles[status ?? 'idle'] ?? styles.idle;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

export default function Analytics() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<MetricsOverview>(emptyOverview);
  const [topMetrics, setTopMetrics] = useState<TopMetric[]>([]);
  const [bindings, setBindings] = useState<SocialBinding[]>([]);
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
    Promise.all([
      fetchMetricsOverview(clientId, days),
      fetchTopMetrics(clientId),
      fetchTikTokBindings(clientId),
    ])
      .then(([overviewData, topData, bindingsData]) => {
        setOverview(overviewData);
        setTopMetrics(topData);
        setBindings(bindingsData);
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
    { label: 'Engagement Rate', value: `${overview.avgEngagementRate.toFixed(2)}%`, color: 'text-violet-600' },
  ];

  const needsReauth = bindings.filter((b) => b.reauthorizationRequired);
  const errorBindings = bindings.filter((b) => b.collectionStatus === 'error');

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
          {collecting ? 'Collecting...' : 'Collect now'}
        </button>
      </div>

      <div className="mb-6">
        <p className="text-sm text-gray-500">{selectedClient ? selectedClient.name : 'No client selected'}</p>
        <h1 className="text-2xl font-semibold text-gray-900">Data Return</h1>
        <p className="mt-1 text-sm text-gray-500">Platform data collection status and metrics</p>
      </div>

      {/* Authorization alerts */}
      {needsReauth.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">Reauthorization Required</p>
          {needsReauth.map((binding) => (
            <p key={binding.id} className="mt-1 text-sm text-amber-700">
              @{binding.username} - {binding.reauthorizationReason || 'Reconnect TikTok to enable metrics collection'}
            </p>
          ))}
        </div>
      )}

      {/* Collection errors */}
      {errorBindings.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">Collection Errors</p>
          {errorBindings.map((binding) => (
            <div key={binding.id} className="mt-1">
              <p className="text-sm text-red-700">
                @{binding.username}: {binding.collectionErrorMessage || binding.collectionErrorCode || 'Unknown error'}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg bg-white p-5 shadow-sm">
            <p className="mb-2 text-sm text-gray-500">{card.label}</p>
            <p className={`text-3xl font-bold ${card.color}`}>{loading ? '-' : card.value}</p>
          </div>
        ))}
      </div>

      {/* Account binding status */}
      <section className="mb-6 rounded-lg bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-medium">TikTok Accounts</h2>
        {bindings.length === 0 ? (
          <p className="text-sm text-gray-500">No TikTok accounts connected</p>
        ) : (
          <div className="space-y-3">
            {bindings.map((binding) => (
              <div key={binding.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                <div>
                  <p className="font-medium text-gray-900">@{binding.username}</p>
                  <p className="text-sm text-gray-500">Status: {binding.status}</p>
                  {binding.reauthorizationRequired && (
                    <p className="text-sm text-amber-600">Needs reauthorization</p>
                  )}
                </div>
                <div className="text-right">
                  <CollectionStatusBadge status={binding.collectionStatus} />
                  {binding.lastCollectionSuccessAt && (
                    <p className="mt-1 text-xs text-gray-500">
                      Last success: {formatDate(binding.lastCollectionSuccessAt)}
                    </p>
                  )}
                  {binding.collectionErrorCode && (
                    <p className="mt-1 text-xs text-red-500">{binding.collectionErrorCode}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="rounded-lg bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium">By Platform</h2>
            <span className="text-sm text-gray-500">{overview.dataPoints} posts tracked</span>
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
              <div key={metric.contentId} className="rounded-lg border border-gray-200 p-3">
                <p className="font-medium text-gray-900">{metric.content?.title || metric.contentId}</p>
                <p className="text-sm capitalize text-gray-500">{metric.platform}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-600">
                  <span>{formatNumber(metric.totalViews)} views</span>
                  <span>{formatNumber(metric.totalLikes)} likes</span>
                </div>
              </div>
            ))}
            {!loading && topMetrics.length === 0 && <p className="text-sm text-gray-500">No ranked content yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
