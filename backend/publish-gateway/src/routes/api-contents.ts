import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, clientIdFromAuth, requireAdmin } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { createOrGetActivePublishJob, transitionContent } from '../domain/publishing-state';
import { publishToTikTok } from '../services/publisher';

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
    const content = await prisma.content.findUnique({ where: { id } });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');
    if (content.status !== 'delivered') throw new AppError(409, 'invalid_state_transition', `Cannot publish content from ${content.status}`);
    const binding = await prisma.accountBinding.findFirst({
      where: { clientId: content.clientId, platform: 'tiktok', active: true, status: 'active', accessToken: { not: null } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!binding) throw new AppError(409, 'invalid_state_transition', 'Content requires an active TikTok account binding');
    const { job, created } = await prisma.$transaction((tx) => createOrGetActivePublishJob(tx, {
      contentId: content.id, accountBindingId: binding.id, platform: 'tiktok', dispatchWhenImmediate: false,
      changedBy: req.auth!.sub, createdNotes: 'Server publishing requested by legacy API',
    }));

    if (created) {
      await prisma.auditLog.create({
        data: {
          action: 'publish_requested', actorId: req.auth!.sub, actorType: 'user', targetType: 'content', targetId: content.id,
          details: JSON.stringify({ jobId: job.id, bindingId: binding.id, source: 'legacy' }),
        },
      });
      publishToTikTok(job.id).catch((error) => console.error(`TikTok publish job ${job.id} failed`, error));
    }

    res.json({ data: { ...serializeContent(content), publishJobId: job.id, publishing: true, idempotent: !created } });
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
