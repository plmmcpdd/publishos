import { prisma } from '../../lib/prisma';
import { upsertDailyMetrics } from './utils';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

export async function collectFacebookMetrics(bindingId: string): Promise<void> {
  const binding = await prisma.accountBinding.findUnique({ where: { id: bindingId } });
  if (!binding || binding.platform !== 'facebook' || binding.status !== 'active' || !binding.accessToken) return;

  const pageId = binding.platformUserId;
  if (!pageId) return;

  const listRes = await fetch(
    `${GRAPH_API_BASE}/${pageId}/feed?fields=id,message,created_time,likes.summary(true),comments.summary(true)&limit=50&access_token=${encodeURIComponent(binding.accessToken)}`,
  );
  const listData = await listRes.json();

  if (!listData.data) {
    console.error('[facebook-collector] list error:', listData.error);
    return;
  }

  for (const post of listData.data) {
    const publishJob = await prisma.publishJob.findFirst({
      where: {
        platform: 'facebook',
        platformPostId: post.id,
        accountBindingId: bindingId,
      },
    });
    if (!publishJob || !publishJob.platformPostId) continue;

    const insightsRes = await fetch(
      `${GRAPH_API_BASE}/${post.id}/insights?metric=post_impressions,post_reactions_by_type_total&access_token=${encodeURIComponent(binding.accessToken)}`,
    );
    const insightsData = await insightsRes.json();
    if (insightsData.error) console.error('[facebook-collector] insights error:', insightsData.error);

    const impressions = Number(insightsData.data?.find((item: any) => item.name === 'post_impressions')?.values?.[0]?.value || 0);
    const likes = Number(post.likes?.summary?.total_count || 0);
    const comments = Number(post.comments?.summary?.total_count || 0);
    const engagementRate = impressions > 0 ? (likes + comments) / impressions : 0;

    await upsertDailyMetrics({
      clientId: binding.clientId,
      contentId: publishJob.contentId,
      publishJobId: publishJob.id,
      platform: 'facebook',
      platformPostId: publishJob.platformPostId,
      views: impressions,
      likes,
      comments,
      impressions,
      engagementRate,
    });
  }
}
