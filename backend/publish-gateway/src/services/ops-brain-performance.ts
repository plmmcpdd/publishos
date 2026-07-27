import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';

const AVAILABILITY = {
  views: 'available', likes: 'available', comments: 'available', shares: 'available',
  saves: 'unavailable_from_current_api', reach: 'unavailable_from_current_api',
  impressions: 'unavailable_from_current_api', completionRate: 'unavailable_from_current_api',
  averageWatchTime: 'unavailable_from_current_api', commentText: 'unavailable_from_current_api',
} as const;
const MAX_TIMELINE_SNAPSHOTS = 5_000;

function iso(value: Date | null): string | null { return value ? value.toISOString() : null; }
function safeErrorCode(value: string | null): string | null {
  return value && /^[a-z0-9_]{1,64}$/iu.test(value) ? value : value ? 'collection_error' : null;
}

function collectionState(bindings: Array<{
  collectionStatus: string; lastCollectionAttemptAt: Date | null; lastCollectionSuccessAt: Date | null;
  reauthorizationRequired: boolean; collectionErrorCode: string | null; collectionErrorMessage: string | null;
}>) {
  if (!bindings.length) return { status: 'idle', lastAttemptAt: null, lastSuccessAt: null, reauthorizationRequired: false, errorCode: null, errorMessage: null };
  const status = bindings.some((binding) => binding.collectionStatus === 'error') ? 'error'
    : bindings.some((binding) => binding.collectionStatus === 'collecting') ? 'collecting'
      : bindings.some((binding) => binding.collectionStatus === 'success') ? 'success' : 'idle';
  const latest = (key: 'lastCollectionAttemptAt' | 'lastCollectionSuccessAt') => bindings.reduce<Date | null>((max, binding) => !max || (binding[key] && binding[key]! > max) ? binding[key] : max, null);
  const errorBinding = bindings.find((binding) => binding.collectionStatus === 'error');
  return {
    status, lastAttemptAt: iso(latest('lastCollectionAttemptAt')), lastSuccessAt: iso(latest('lastCollectionSuccessAt')),
    reauthorizationRequired: bindings.some((binding) => binding.reauthorizationRequired),
    errorCode: safeErrorCode(errorBinding?.collectionErrorCode || null),
    errorMessage: errorBinding?.collectionErrorMessage ? 'Metrics collection failed.' : null,
  };
}

export async function getOpsBrainPerformance(input: { clientId: string; contentRef: string; days: number; generatedAt?: Date }) {
  const generatedAt = input.generatedAt || new Date();
  const content = await prisma.content.findFirst({
    where: { clientId: input.clientId, contentRef: input.contentRef },
    select: { id: true, clientId: true, contentRef: true, title: true, status: true },
  });
  if (!content) throw new AppError(404, 'ops_brain_content_not_found', 'No matching content was found.');

  const posts = await prisma.publishedPost.findMany({
    where: {
      publishJob: { contentId: content.id, accountBinding: { clientId: input.clientId } },
      accountBinding: { clientId: input.clientId },
    },
    select: {
      id: true, platform: true, platformPostId: true, platformPostUrl: true, publishedAt: true, status: true,
      publishJobId: true,
      accountBinding: { select: { collectionStatus: true, lastCollectionAttemptAt: true, lastCollectionSuccessAt: true, reauthorizationRequired: true, collectionErrorCode: true, collectionErrorMessage: true } },
      performanceMetrics: {
        where: { clientId: input.clientId, contentId: content.id },
        orderBy: [{ observedAt: 'desc' }, { collectedAt: 'desc' }, { id: 'desc' }], take: 1,
      },
    },
    orderBy: { id: 'asc' },
  });
  const postIds = posts.map((post) => post.id);
  const since = new Date(generatedAt.getTime() - input.days * 24 * 60 * 60 * 1000);
  const timeline = postIds.length ? await prisma.performanceMetrics.findMany({
    where: { clientId: input.clientId, contentId: content.id, publishedPostId: { in: postIds }, observedAt: { gte: since } },
    select: { id: true, publishedPostId: true, observedAt: true, collectedAt: true, views: true, likes: true, comments: true, shares: true, saves: true, reach: true, impressions: true, engagementRate: true, completionRate: true, averageWatchTime: true, source: true, rawResponseHash: true },
    orderBy: [{ observedAt: 'asc' }, { collectedAt: 'asc' }, { id: 'asc' }], take: MAX_TIMELINE_SNAPSHOTS,
  }) : [];
  const snapshots = new Map<string, typeof timeline>();
  for (const metric of timeline) {
    if (!metric.publishedPostId) continue;
    const current = snapshots.get(metric.publishedPostId) || [];
    current.push(metric); snapshots.set(metric.publishedPostId, current);
  }
  const totals = posts.reduce((sum, post) => {
    const metric = post.performanceMetrics[0];
    return { views: sum.views + (metric?.views ?? 0), likes: sum.likes + (metric?.likes ?? 0), comments: sum.comments + (metric?.comments ?? 0), shares: sum.shares + (metric?.shares ?? 0) };
  }, { views: 0, likes: 0, comments: 0, shares: 0 });
  const engagementRate = totals.views > 0 ? (totals.likes + totals.comments + totals.shares) / totals.views : 0;
  return {
    schemaVersion: 'publishos.ops-brain.performance.v1', generatedAt: generatedAt.toISOString(), clientId: input.clientId,
    content: { id: content.id, contentRef: content.contentRef, title: content.title, status: content.status },
    collection: collectionState(posts.map((post) => post.accountBinding)),
    latestTotals: { ...totals, engagementRate },
    posts: posts.map((post) => ({
      publishedPostId: post.id, platform: post.platform, platformPostId: post.platformPostId, platformPostUrl: post.platformPostUrl,
      publishedAt: iso(post.publishedAt), status: post.status,
      snapshots: (snapshots.get(post.id) || []).map((metric) => ({
        observedAt: metric.observedAt.toISOString(), collectedAt: metric.collectedAt.toISOString(), views: metric.views, likes: metric.likes,
        comments: metric.comments, shares: metric.shares, saves: metric.saves, reach: metric.reach, impressions: metric.impressions,
        engagementRate: metric.engagementRate, completionRate: metric.completionRate, averageWatchTime: metric.averageWatchTime,
        source: metric.source, rawResponseHash: metric.rawResponseHash,
      })),
    })),
    availability: AVAILABILITY,
  };
}
