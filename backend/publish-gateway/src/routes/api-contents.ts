import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

function serializeContent(content: any) {
  return {
    ...content,
    platform: firstPlatform(content.platforms),
    thumbnail_url: content.thumbnailUrl,
  };
}

function firstPlatform(value?: string) {
  if (!value) return 'tiktok';
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed[0] ? String(parsed[0]) : value;
  } catch {
    return value;
  }
}

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

  res.json({ data: contents.map(serializeContent) });
});

router.post('/:id/publish', async (req, res) => {
  try {
    const content = await prisma.content.update({
      where: { id: req.params.id },
      data: { status: 'published' },
    });

    res.json({ data: serializeContent(content) });
  } catch {
    res.status(404).json({ error: res.locals.t('errors.contentNotFound') });
  }
});

export default router;
