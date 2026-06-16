import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

function parseDays(value: unknown): number {
  const days = Number(value || 30);
  return Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
}

function requireClientId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

router.get('/metrics/overview', async (req, res) => {
  try {
    const clientId = requireClientId(req.query.clientId);
    if (!clientId) {
      res.status(400).json({ success: false, error: 'clientId required' });
      return;
    }

    const days = parseDays(req.query.days);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const metrics = await prisma.performanceMetrics.findMany({
      where: {
        clientId,
        collectedAt: { gte: since },
      },
      orderBy: { collectedAt: 'desc' },
    });

    const totals = metrics.reduce(
      (sum, metric) => ({
        views: sum.views + metric.views,
        likes: sum.likes + metric.likes,
        comments: sum.comments + metric.comments,
        shares: sum.shares + metric.shares,
        saves: sum.saves + metric.saves,
        impressions: sum.impressions + metric.impressions,
        reach: sum.reach + metric.reach,
        engagementRate: sum.engagementRate + metric.engagementRate,
      }),
      { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, impressions: 0, reach: 0, engagementRate: 0 },
    );

    const byPlatform: Record<string, { views: number; likes: number; comments: number; shares: number }> = {};
    for (const metric of metrics) {
      if (!byPlatform[metric.platform]) byPlatform[metric.platform] = { views: 0, likes: 0, comments: 0, shares: 0 };
      byPlatform[metric.platform].views += metric.views;
      byPlatform[metric.platform].likes += metric.likes;
      byPlatform[metric.platform].comments += metric.comments;
      byPlatform[metric.platform].shares += metric.shares;
    }

    const avgEngagement = metrics.length > 0 ? totals.engagementRate / metrics.length : 0;

    res.json({
      success: true,
      data: {
        totalViews: totals.views,
        totalLikes: totals.likes,
        totalComments: totals.comments,
        totalShares: totals.shares,
        totalSaves: totals.saves,
        totalReach: totals.reach,
        totalImpressions: totals.impressions,
        avgEngagementRate: Math.round(avgEngagement * 10000) / 100,
        byPlatform,
        dataPoints: metrics.length,
        period: `${days} days`,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

router.get('/metrics/content/:contentId', async (req, res) => {
  try {
    const clientId = requireClientId(req.query.clientId);
    if (!clientId) {
      res.status(400).json({ success: false, error: 'clientId required' });
      return;
    }

    const metrics = await prisma.performanceMetrics.findMany({
      where: {
        clientId,
        contentId: req.params.contentId,
      },
      orderBy: { collectedAt: 'desc' },
    });

    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

router.get('/metrics/top', async (req, res) => {
  try {
    const clientId = requireClientId(req.query.clientId);
    if (!clientId) {
      res.status(400).json({ success: false, error: 'clientId required' });
      return;
    }

    const where = {
      clientId,
      ...(req.query.platform ? { platform: String(req.query.platform) } : {}),
    };

    const top = await prisma.performanceMetrics.findMany({
      where,
      orderBy: { views: 'desc' },
      take: Math.min(Number(req.query.limit) || 10, 50),
      include: { content: { select: { id: true, title: true } } },
    });

    res.json({ success: true, data: top });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

router.post('/metrics/collect', async (_req, res) => {
  try {
    const { collectAllMetrics } = await import('../services/metrics-collector');
    collectAllMetrics().catch((error) => console.error('[metrics] manual collection failed:', error));
    res.json({ success: true, message: 'Collection started' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
