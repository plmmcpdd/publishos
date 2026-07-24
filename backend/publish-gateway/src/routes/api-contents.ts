import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, clientIdFromAuth, requireAdmin } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { transitionContent } from '../domain/publishing-state';

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
  const mapped = requested.flatMap((item) => {
    if (item === 'queued') return ['pending_review', 'approved'];
    if (item === 'pending') return ['pending_review'];
    if (item === 'confirmed') return ['published'];
    return [item];
  });

  return { in: [...new Set(mapped)] as any };
}

router.get('/', authenticateToken, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : undefined;

  const scopedClientId = clientIdFromAuth(req, clientId);
  if (!scopedClientId) {
    res.status(400).json({ error: 'client_id is required' });
    return;
  }

  const contents = await prisma.content.findMany({
    where: {
      clientId: scopedClientId,
      ...(status ? { status: statusFilter(status) } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  res.json({ data: contents.map(serializeContent) });
});

router.post('/:id/publish', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.$transaction((tx) => transitionContent(tx, id, 'delivered', 'published', { publishedAt: new Date() }));
    const content = await prisma.content.findUnique({ where: { id } });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');

    await prisma.auditLog.create({
      data: {
        action: 'publish',
        actorId: 'dashboard',
        actorType: 'user',
        targetType: 'content',
        targetId: content.id,
      },
    });

    res.json({ data: serializeContent(content) });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw error;
  }
});

router.post('/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.$transaction((tx) => transitionContent(tx, id, ['draft', 'pending_review', 'rejected'], 'approved'));
    const content = await prisma.content.findUnique({ where: { id } });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');

    await prisma.auditLog.create({
      data: {
        action: 'approve',
        actorId: 'dashboard',
        actorType: 'user',
        targetType: 'content',
        targetId: content.id,
      },
    });

    res.json({ data: serializeContent(content) });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw error;
  }
});

router.post('/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.$transaction((tx) => transitionContent(tx, id, ['draft', 'pending_review'], 'rejected'));
    const content = await prisma.content.findUnique({ where: { id } });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');

    await prisma.auditLog.create({
      data: {
        action: 'reject',
        actorId: 'dashboard',
        actorType: 'user',
        targetType: 'content',
        targetId: content.id,
      },
    });

    res.json({ data: serializeContent(content) });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw error;
  }
});

export default router;
