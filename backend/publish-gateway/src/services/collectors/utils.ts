import { prisma } from '../../lib/prisma';

export function getMetricDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function upsertDailyMetrics(input: {
  clientId: string;
  contentId: string;
  publishJobId: string;
  publishedPostId?: string | null;
  platform: string;
  platformPostId: string;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  reach?: number | null;
  impressions?: number | null;
  engagementRate?: number | null;
  completionRate?: number | null;
  averageWatchTime?: number | null;
  source?: string;
  rawResponseHash?: string | null;
}) {
  const metricDate = getMetricDate();
  const now = new Date();
  const publishedPostId = input.publishedPostId ?? null;

  const metricData = {
    clientId: input.clientId,
    contentId: input.contentId,
    publishJobId: input.publishJobId,
    publishedPostId,
    platform: input.platform,
    platformPostId: input.platformPostId,
    views: input.views ?? null,
    likes: input.likes ?? null,
    comments: input.comments ?? null,
    shares: input.shares ?? null,
    saves: input.saves ?? null,
    reach: input.reach ?? null,
    impressions: input.impressions ?? null,
    engagementRate: input.engagementRate ?? null,
    completionRate: input.completionRate ?? null,
    averageWatchTime: input.averageWatchTime ?? null,
    collectedAt: now,
    observedAt: now,
    source: input.source ?? 'tiktok_api',
    rawResponseHash: input.rawResponseHash ?? null,
  };

  // Try to find existing record by publishedPostId if available, otherwise by publishJobId
  const existing = publishedPostId
    ? await prisma.performanceMetrics.findFirst({
        where: { publishedPostId, period: 'daily', metricDate },
      })
    : await prisma.performanceMetrics.findFirst({
        where: { publishJobId: input.publishJobId, period: 'daily', metricDate, publishedPostId: null },
      });

  if (existing) {
    return prisma.performanceMetrics.update({
      where: { id: existing.id },
      data: {
        ...metricData,
        metricDate,
        period: 'daily',
      },
    });
  }

  return prisma.performanceMetrics.create({
    data: {
      ...metricData,
      metricDate,
      period: 'daily',
    },
  });
}
