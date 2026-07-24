import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();

// GET /audit - query audit logs
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  const { client_id, from, to, action, target_type } = req.query;
  
  const logs = await prisma.auditLog.findMany({
    where: {
      ...(action && { action: action as string }),
      ...(target_type && { targetType: target_type as string }),
      ...(from && to && {
        createdAt: {
          gte: new Date(from as string),
          lte: new Date(to as string),
        }
      }),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json({ data: logs });
});

// GET /audit/publish-summary - publish success/failure summary
router.get('/publish-summary', authenticateToken, requireAdmin, async (req, res) => {
  const { from, to } = req.query;
  
  const jobs = await prisma.publishJob.findMany({
    where: {
      ...(from && to && {
        createdAt: {
          gte: new Date(from as string),
          lte: new Date(to as string),
        }
      }),
    },
    select: {
      status: true,
      platform: true,
      errorCode: true,
      publishedAt: true,
    }
  });

  const summary = {
    total: jobs.length,
    by_status: {} as Record<string, number>,
    by_platform: {} as Record<string, { total: number; success: number; failed: number }>,
    errors: {} as Record<string, number>,
  };

  for (const job of jobs) {
    summary.by_status[job.status] = (summary.by_status[job.status] || 0) + 1;
    
    const plat = job.platform;
    if (!summary.by_platform[plat]) {
      summary.by_platform[plat] = { total: 0, success: 0, failed: 0 };
    }
    summary.by_platform[plat].total++;
    if (job.status === 'published') summary.by_platform[plat].success++;
    if (job.status === 'failed') summary.by_platform[plat].failed++;
    
    if (job.errorCode) {
      summary.errors[job.errorCode] = (summary.errors[job.errorCode] || 0) + 1;
    }
  }

  res.json(summary);
});

export default router;
