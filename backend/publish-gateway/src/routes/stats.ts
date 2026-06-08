import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/', async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayPublished, pending, totalCustomers, failed] = await Promise.all([
    prisma.content.count({
      where: {
        status: 'published',
        updatedAt: { gte: today },
      },
    }),
    prisma.content.count({ where: { status: 'pending_review' } }),
    prisma.client.count(),
    prisma.content.count({ where: { status: 'failed' } }),
  ]);

  res.json({
    todayPublished,
    pending,
    totalCustomers,
    failed,
  });
});

export default router;
