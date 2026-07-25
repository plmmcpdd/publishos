import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { sendInternalError } from '../middleware/errors';

const router = Router();

function parseDays(value: unknown): number {
  const days = Number(value || 30);
  return Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
}

function requireClientId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

router.get('/metrics/overview', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const clientId = requireClientId(req.query.clientId);
    if (!clientId) {
      res.status(400).json({ success: false, error: 'clientId required' });
      return;
    }

    const days = parseDays(req.query.days);
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get all metrics for this client in the period
    const metrics = await prisma.performanceMetrics.findMany({
      where: {
        clientId,
        collectedAt: { gte: since },
      },
      orderBy: { collectedAt: 'desc' },
    });

    // Group by publishedPostId to get latest snapshot per post
    const latestByPost = new Map<string, typeof metrics[0]>();
    for (const metric of metrics) {
      const key = metric.publishedPostId ?? metric.publishJobId;
      if (!latestByPost.has(key)) {
        latestByPost.set(key, metric);
      }
    }

    // Aggregate latest snapshots
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;
    let totalSaves = 0;
    let totalReach = 0;
    let totalImpressions = 0;

    const byPlatform: Record<string, { views: number; likes: number; comments: number; shares: number }> = {};

    for (const metric of latestByPost.values()) {
      const views = metric.views ?? 0;
      const likes = metric.likes ?? 0;
      const comments = metric.comments ?? 0;
      const shares = metric.shares ?? 0;
      const saves = metric.saves ?? 0;
      const reach = metric.reach ?? 0;
      const impressions = metric.impressions ?? 0;

      totalViews += views;
      totalLikes += likes;
      totalComments += comments;
      totalShares += shares;
      totalSaves += saves;
      totalReach += reach;
      totalImpressions += impressions;

      if (!byPlatform[metric.platform]) {
        byPlatform[metric.platform] = { views: 0, likes: 0, comments: 0, shares: 0 };
      }
      byPlatform[metric.platform].views += views;
      byPlatform[metric.platform].likes += likes;
      byPlatform[metric.platform].comments += comments;
      byPlatform[metric.platform].shares += shares;
    }

    // Correct engagement rate: (total likes + comments + shares) / total views
    const engagementRate = totalViews > 0
      ? (totalLikes + totalComments + totalShares) / totalViews
      : 0;

    res.json({
      success: true,
      data: {
        totalViews,
        totalLikes,
        totalComments,
        totalShares,
        totalSaves,
        totalReach,
        totalImpressions,
        avgEngagementRate: Math.round(engagementRate * 10000) / 100,
        byPlatform,
        dataPoints: latestByPost.size,
        period: `${days} days`,
      },
    });
  } catch (error) {
    sendInternalError(req, res);
  }
});

router.get('/metrics/content/:contentId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const clientId = requireClientId(req.query.clientId);
    if (!clientId) {
      res.status(400).json({ success: false, error: 'clientId required' });
      return;
    }

    const metrics = await prisma.performanceMetrics.findMany({
      where: {
        clientId,
        contentId: String(req.params.contentId),
      },
      orderBy: { collectedAt: 'desc' },
      include: {
        publishedPost: {
          select: { id: true, platformPostId: true, status: true },
        },
      },
    });

    res.json({ success: true, data: metrics });
  } catch (error) {
    sendInternalError(req, res);
  }
});

router.get('/metrics/top', authenticateToken, requireAdmin, async (req, res) => {
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

    // Get all metrics for this client
    const allMetrics = await prisma.performanceMetrics.findMany({
      where,
      include: { content: { select: { id: true, title: true } } },
    });

    // Group by contentId, taking latest snapshot per publishedPost
    const contentMap = new Map<string, {
      contentId: string;
      content?: { id: string; title: string } | null;
      platform: string;
      totalViews: number;
      totalLikes: number;
      totalComments: number;
      totalShares: number;
    }>();

    const latestByPost = new Map<string, typeof allMetrics[0]>();
    for (const metric of allMetrics) {
      const key = metric.publishedPostId ?? metric.publishJobId;
      const existing = latestByPost.get(key);
      if (!existing || metric.collectedAt > existing.collectedAt) {
        latestByPost.set(key, metric);
      }
    }

    for (const metric of latestByPost.values()) {
      const existing = contentMap.get(metric.contentId);
      if (existing) {
        existing.totalViews += (metric.views ?? 0);
        existing.totalLikes += (metric.likes ?? 0);
        existing.totalComments += (metric.comments ?? 0);
        existing.totalShares += (metric.shares ?? 0);
      } else {
        contentMap.set(metric.contentId, {
          contentId: metric.contentId,
          content: metric.content,
          platform: metric.platform,
          totalViews: metric.views ?? 0,
          totalLikes: metric.likes ?? 0,
          totalComments: metric.comments ?? 0,
          totalShares: metric.shares ?? 0,
        });
      }
    }

    // Sort by total views descending, then by contentId for stable sort
    const top = Array.from(contentMap.values())
      .sort((a, b) => b.totalViews - a.totalViews || a.contentId.localeCompare(b.contentId))
      .slice(0, Math.min(Number(req.query.limit) || 10, 50));

    res.json({ success: true, data: top });
  } catch (error) {
    sendInternalError(req, res);
  }
});

router.post('/metrics/collect', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { collectAllMetrics } = await import('../services/metrics-collector');
    collectAllMetrics().catch((error) => console.error('[metrics] manual collection failed:', error));
    res.json({ success: true, message: 'Collection started' });
  } catch (error) {
    sendInternalError(req, res);
  }
});

export default router;
