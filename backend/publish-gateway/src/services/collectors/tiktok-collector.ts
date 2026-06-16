import { prisma } from '../../lib/prisma';
import { upsertDailyMetrics } from './utils';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

/**
 * DATA COLLECTION COMPLIANCE NOTE:
 * - All metrics are collected only for accounts explicitly authorized by the client.
 * - No cross-client aggregation, benchmarking, or industry comparison is performed.
 * - Data is used solely for the client's own content optimization and reporting.
 */
export async function collectTikTokMetrics(bindingId: string): Promise<void> {
  const binding = await prisma.accountBinding.findUnique({ where: { id: bindingId } });
  if (!binding || binding.platform !== 'tiktok' || binding.status !== 'active' || !binding.accessToken) return;

  const listRes = await fetch(
    `${TIKTOK_API_BASE}/video/list/?fields=id,title,create_time,like_count,comment_count,share_count,view_count`,
    { headers: { Authorization: `Bearer ${binding.accessToken}` } },
  );
  const listData = await listRes.json();

  if (listData.error?.code && listData.error.code !== 'ok') {
    console.error('[tiktok-collector] list error:', listData.error);
    return;
  }

  const videos = listData.data?.videos || [];
  for (const video of videos) {
    const publishJob = await prisma.publishJob.findFirst({
      where: {
        platform: 'tiktok',
        platformPostId: video.id,
        accountBindingId: bindingId,
      },
    });
    if (!publishJob || !publishJob.platformPostId) continue;

    const views = Number(video.view_count || 0);
    const likes = Number(video.like_count || 0);
    const comments = Number(video.comment_count || 0);
    const shares = Number(video.share_count || 0);
    const engagementRate = views > 0 ? (likes + comments + shares) / views : 0;

    await upsertDailyMetrics({
      clientId: binding.clientId,
      contentId: publishJob.contentId,
      publishJobId: publishJob.id,
      platform: 'tiktok',
      platformPostId: publishJob.platformPostId,
      views,
      likes,
      comments,
      shares,
      engagementRate,
    });
  }
}
