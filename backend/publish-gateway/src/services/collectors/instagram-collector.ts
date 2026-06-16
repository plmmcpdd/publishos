import { prisma } from '../../lib/prisma';
import { upsertDailyMetrics } from './utils';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

export async function collectInstagramMetrics(bindingId: string): Promise<void> {
  const binding = await prisma.accountBinding.findUnique({ where: { id: bindingId } });
  if (!binding || binding.platform !== 'instagram' || binding.status !== 'active' || !binding.accessToken) return;

  const igUserId = binding.platformUserId;
  if (!igUserId) return;

  const listRes = await fetch(
    `${GRAPH_API_BASE}/${igUserId}/media?fields=id,caption,media_type,like_count,comments_count,timestamp&limit=50&access_token=${encodeURIComponent(binding.accessToken)}`,
  );
  const listData = await listRes.json();

  if (!listData.data) {
    console.error('[instagram-collector] list error:', listData.error);
    return;
  }

  for (const media of listData.data) {
    const publishJob = await prisma.publishJob.findFirst({
      where: {
        platform: 'instagram',
        platformPostId: media.id,
        accountBindingId: bindingId,
      },
    });
    if (!publishJob || !publishJob.platformPostId) continue;

    const insightsRes = await fetch(
      `${GRAPH_API_BASE}/${media.id}/insights?metric=impressions,reach,saved&access_token=${encodeURIComponent(binding.accessToken)}`,
    );
    const insightsData = await insightsRes.json();
    if (insightsData.error) console.error('[instagram-collector] insights error:', insightsData.error);

    const impressions = Number(insightsData.data?.find((item: any) => item.name === 'impressions')?.values?.[0]?.value || 0);
    const reach = Number(insightsData.data?.find((item: any) => item.name === 'reach')?.values?.[0]?.value || 0);
    const saves = Number(insightsData.data?.find((item: any) => item.name === 'saved')?.values?.[0]?.value || 0);
    const likes = Number(media.like_count || 0);
    const comments = Number(media.comments_count || 0);
    const engagementRate = reach > 0 ? (likes + comments + saves) / reach : 0;

    await upsertDailyMetrics({
      clientId: binding.clientId,
      contentId: publishJob.contentId,
      publishJobId: publishJob.id,
      platform: 'instagram',
      platformPostId: publishJob.platformPostId,
      views: impressions,
      likes,
      comments,
      saves,
      reach,
      impressions,
      engagementRate,
    });
  }
}
