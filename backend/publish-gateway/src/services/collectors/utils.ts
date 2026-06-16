import { prisma } from '../../lib/prisma';

export function getMetricDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function upsertDailyMetrics(input: {
  clientId: string;
  contentId: string;
  publishJobId: string;
  platform: string;
  platformPostId: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reach?: number;
  impressions?: number;
  engagementRate?: number;
  completionRate?: number | null;
}) {
  const metricDate = getMetricDate();
  const now = new Date();

  return prisma.performanceMetrics.upsert({
    where: {
      publishJobId_period_metricDate: {
        publishJobId: input.publishJobId,
        period: 'daily',
        metricDate,
      },
    },
    update: {
      views: input.views ?? 0,
      likes: input.likes ?? 0,
      comments: input.comments ?? 0,
      shares: input.shares ?? 0,
      saves: input.saves ?? 0,
      reach: input.reach ?? 0,
      impressions: input.impressions ?? 0,
      engagementRate: input.engagementRate ?? 0,
      completionRate: input.completionRate,
      collectedAt: now,
      platformPostId: input.platformPostId,
    },
    create: {
      clientId: input.clientId,
      contentId: input.contentId,
      publishJobId: input.publishJobId,
      platform: input.platform,
      platformPostId: input.platformPostId,
      views: input.views ?? 0,
      likes: input.likes ?? 0,
      comments: input.comments ?? 0,
      shares: input.shares ?? 0,
      saves: input.saves ?? 0,
      reach: input.reach ?? 0,
      impressions: input.impressions ?? 0,
      engagementRate: input.engagementRate ?? 0,
      completionRate: input.completionRate,
      collectedAt: now,
      metricDate,
      period: 'daily',
    },
  });
}
