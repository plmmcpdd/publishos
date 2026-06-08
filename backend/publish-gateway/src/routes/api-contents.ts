import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

function statusFilter(status?: string) {
  if (!status) return undefined;
  const requested = status.split(',').map((item) => item.trim()).filter(Boolean);
  if (requested.includes('queued')) {
    return { in: ['pending_review', 'approved'] as const };
  }
  return { in: requested as any };
}

router.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const contents = await prisma.content.findMany({
    where: {
      ...(status ? { status: statusFilter(status) } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  res.json({ data: contents });
});

router.post('/:id/publish', async (req, res) => {
  try {
    const content = await prisma.content.update({
      where: { id: req.params.id },
      data: { status: 'published' },
    });

    res.json({ data: content });
  } catch {
    res.status(404).json({ error: res.locals.t('errors.contentNotFound') });
  }
});

export default router;
