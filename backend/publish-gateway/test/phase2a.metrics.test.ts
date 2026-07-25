import { describe, expect, it } from 'vitest';

// Test the aggregation logic directly
function aggregateMetrics(metrics: Array<{
  publishedPostId: string | null;
  publishJobId: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  collectedAt: Date;
}>) {
  // Group by publishedPostId to get latest snapshot per post
  const latestByPost = new Map<string, typeof metrics[0]>();
  for (const metric of metrics) {
    const key = metric.publishedPostId ?? metric.publishJobId;
    const existing = latestByPost.get(key);
    if (!existing || metric.collectedAt > existing.collectedAt) {
      latestByPost.set(key, metric);
    }
  }

  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;

  for (const metric of latestByPost.values()) {
    totalViews += (metric.views ?? 0);
    totalLikes += (metric.likes ?? 0);
    totalComments += (metric.comments ?? 0);
    totalShares += (metric.shares ?? 0);
  }

  const engagementRate = totalViews > 0
    ? (totalLikes + totalComments + totalShares) / totalViews
    : 0;

  return { totalViews, totalLikes, totalComments, totalShares, engagementRate };
}

describe('Phase 2A: Metrics aggregation', () => {
  it('takes latest snapshot per publishedPostId', () => {
    const metrics = [
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 100, likes: 10, comments: 5, shares: 2, collectedAt: new Date('2024-01-01') },
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 500, likes: 50, comments: 25, shares: 10, collectedAt: new Date('2024-01-02') },
    ];
    const result = aggregateMetrics(metrics);
    expect(result.totalViews).toBe(500);
    expect(result.totalLikes).toBe(50);
  });

  it('aggregates multiple posts correctly', () => {
    const metrics = [
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 100, likes: 10, comments: 5, shares: 2, collectedAt: new Date('2024-01-02') },
      { publishedPostId: 'post-2', publishJobId: 'job-2', views: 200, likes: 20, comments: 10, shares: 5, collectedAt: new Date('2024-01-02') },
    ];
    const result = aggregateMetrics(metrics);
    expect(result.totalViews).toBe(300);
    expect(result.totalLikes).toBe(30);
    expect(result.totalComments).toBe(15);
    expect(result.totalShares).toBe(7);
  });

  it('calculates engagement rate correctly', () => {
    const metrics = [
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 1000, likes: 50, comments: 30, shares: 20, collectedAt: new Date('2024-01-01') },
    ];
    const result = aggregateMetrics(metrics);
    // (50 + 30 + 20) / 1000 = 0.1
    expect(result.engagementRate).toBeCloseTo(0.1);
  });

  it('returns 0 engagement rate when views are 0', () => {
    const metrics = [
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 0, likes: 10, comments: 5, shares: 2, collectedAt: new Date('2024-01-01') },
    ];
    const result = aggregateMetrics(metrics);
    expect(result.engagementRate).toBe(0);
  });

  it('handles null values as 0', () => {
    const metrics = [
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: null, likes: null, comments: null, shares: null, collectedAt: new Date('2024-01-01') },
    ];
    const result = aggregateMetrics(metrics);
    expect(result.totalViews).toBe(0);
    expect(result.totalLikes).toBe(0);
    expect(result.engagementRate).toBe(0);
  });

  it('does not double count daily snapshots', () => {
    const metrics = [
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 100, likes: 10, comments: 5, shares: 2, collectedAt: new Date('2024-01-01') },
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 500, likes: 50, comments: 25, shares: 10, collectedAt: new Date('2024-01-02') },
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 1200, likes: 120, comments: 60, shares: 30, collectedAt: new Date('2024-01-03') },
    ];
    const result = aggregateMetrics(metrics);
    // Should take only the latest (1200), not sum all (100+500+1200=1800)
    expect(result.totalViews).toBe(1200);
  });

  it('handles multi-post multi-day correctly', () => {
    const metrics = [
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 100, likes: 10, comments: 5, shares: 2, collectedAt: new Date('2024-01-01') },
      { publishedPostId: 'post-1', publishJobId: 'job-1', views: 500, likes: 50, comments: 25, shares: 10, collectedAt: new Date('2024-01-02') },
      { publishedPostId: 'post-2', publishJobId: 'job-2', views: 200, likes: 20, comments: 10, shares: 5, collectedAt: new Date('2024-01-01') },
      { publishedPostId: 'post-2', publishJobId: 'job-2', views: 800, likes: 80, comments: 40, shares: 20, collectedAt: new Date('2024-01-02') },
    ];
    const result = aggregateMetrics(metrics);
    // post-1 latest: 500, post-2 latest: 800
    expect(result.totalViews).toBe(1300);
    expect(result.totalLikes).toBe(130);
  });

  it('falls back to publishJobId when publishedPostId is null', () => {
    const metrics = [
      { publishedPostId: null, publishJobId: 'job-1', views: 100, likes: 10, comments: 5, shares: 2, collectedAt: new Date('2024-01-01') },
      { publishedPostId: null, publishJobId: 'job-1', views: 500, likes: 50, comments: 25, shares: 10, collectedAt: new Date('2024-01-02') },
    ];
    const result = aggregateMetrics(metrics);
    expect(result.totalViews).toBe(500);
  });
});
