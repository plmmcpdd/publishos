import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { publishToTikTok } from '../services/publisher';
import { authenticateToken, clientIdFromAuth, requireAdmin, requireClient } from '../middleware/auth';
import { AppError, sendInternalError } from '../middleware/errors';
import { createOrGetActivePublishJob, transitionContent } from '../domain/publishing-state';

const router = Router();
const safeClient = { id: true, name: true, email: true, industry: true, active: true, createdAt: true, updatedAt: true } as const;
const safeAccountBinding = {
  id: true, clientId: true, platform: true, accountUsername: true, platformUserId: true,
  username: true, status: true, active: true, expiresAt: true, createdAt: true, updatedAt: true,
} as const;
const safePublishJob = {
  id: true, contentId: true, accountBindingId: true, platform: true, status: true, scheduleAt: true,
  publishId: true, platformPostId: true, platformPostUrl: true, publishedAt: true, failedAt: true,
  errorCode: true, errorMessage: true, retryable: true, retryCount: true, createdAt: true, updatedAt: true,
  accountBinding: { select: safeAccountBinding },
} as const;

const createContentSchema = z.object({
  clientId: z.string().optional(),
  client_id: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  videoUrl: z.string().optional(),
  video_url: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  thumbnail_url: z.string().optional(),
  aiGenerated: z.boolean().optional(),
  ai_generated: z.boolean().optional(),
  aiTools: z.array(z.string()).optional(),
  ai_tools: z.array(z.string()).optional(),
  platform: z.string().optional(),
  platforms: z.array(z.string()).optional(),
  scheduleAt: z.string().datetime().optional(),
  schedule_at: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional(),
  status: z.enum(['pending_review', 'draft']).optional(),
  assets: z.array(z.object({
    type: z.string(),
    source: z.string().optional(),
    license_id: z.string().optional(),
    url: z.string().url(),
    authorization_doc_url: z.string().url().optional(),
    description: z.string().optional(),
  })).optional(),
}).refine((data) => data.clientId || data.client_id, {
  message: 'clientId is required',
});

// Strip sensitive fields from client objects in responses
function sanitizeClient(client: any) {
  if (!client) return client;
  const { password, ...safe } = client;
  return safe;
}

function sanitizeContent(content: any) {
  if (!content) return content;
  return {
    ...content,
    client: sanitizeClient(content.client),
  };
}

function serializeContent(content: any) {
  if (!content) return content;
  // Include latest publish job error if available
  const latestJob = content.publishJobs?.[0];
  return sanitizeContent({
    ...content,
    platform: firstPlatform(content.platforms),
    thumbnail_url: content.thumbnailUrl,
    publishError: latestJob?.errorMessage || null,
    publishJobStatus: latestJob?.status || null,
  });
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
  if (!status || status === 'all') return undefined;
  const mapped = status.split(',').map((item) => item.trim()).filter(Boolean).flatMap((item) => {
    if (item === 'queued') return ['pending_review', 'approved'];
    if (item === 'pending') return ['pending_review'];
    return [item];
  });

  return { in: [...new Set(mapped)] as any };
}

async function writeAudit(data: {
  action: string;
  actorId?: string;
  actorType: string;
  targetType: string;
  targetId: string;
  details?: string;
  deviceId?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      action: data.action,
      actorId: data.actorId || data.actorType,
      actorType: data.actorType,
      targetType: data.targetType,
      targetId: data.targetId,
      details: data.details,
      deviceId: data.deviceId || null,
    },
  }).catch(() => {});
}

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const parse = createContentSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(422).json({ success: false, error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;
  const clientId = data.clientId || data.client_id!;
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  const platformList = data.platforms?.length ? data.platforms : [data.platform || 'tiktok'];
  const videoUrl = data.videoUrl || data.video_url || 'mock/video.mp4';
  const scheduleAt = data.scheduleAt || data.schedule_at;

  const content = await prisma.content.create({
    data: {
      clientId,
      title: data.title,
      description: data.description,
      caption: data.caption,
      hashtags: JSON.stringify(data.hashtags || []),
      videoUrl,
      thumbnailUrl: data.thumbnailUrl || data.thumbnail_url,
      aiGenerated: data.aiGenerated ?? data.ai_generated ?? false,
      aiTools: JSON.stringify(data.aiTools || data.ai_tools || []),
      platforms: JSON.stringify(platformList),
      scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      status: data.status || 'draft',
      assets: {
        create: (data.assets || []).map((asset) => ({
          type: asset.type,
          source: asset.source,
          licenseId: asset.license_id,
          url: asset.url,
          authorizationDocUrl: asset.authorization_doc_url,
          description: asset.description,
        })),
      },
    },
    include: { assets: true, client: { select: safeClient } },
  });

  await writeAudit({
    action: 'create_content',
    actorType: 'dashboard',
    targetType: 'content',
    targetId: content.id,
    details: JSON.stringify({ title: data.title, clientId }),
  });

  res.status(201).json({ success: true, data: serializeContent(content) });
});

router.get('/', authenticateToken, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const clientId = typeof req.query.clientId === 'string'
    ? req.query.clientId
    : typeof req.query.client_id === 'string'
      ? req.query.client_id
      : undefined;

  const scopedClientId = clientIdFromAuth(req, clientId);
  const contents = await prisma.content.findMany({
    where: {
      ...(status ? { status: statusFilter(status) } : {}),
      ...(scopedClientId ? { clientId: scopedClientId } : {}),
    },
    include: { assets: true, client: { select: safeClient }, publishJobs: { select: safePublishJob, orderBy: { createdAt: 'desc' } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json({ success: true, data: contents.map(serializeContent) });
});

// Must be registered before /:id.
router.get('/delivered', authenticateToken, async (req, res) => {
  try {
    const clientId = typeof req.query.clientId === 'string'
      ? req.query.clientId
      : typeof req.query.client_id === 'string'
        ? req.query.client_id
        : undefined;

    const scopedClientId = clientIdFromAuth(req, clientId);
    const contents = await prisma.content.findMany({
      where: {
        status: 'delivered',
        ...(scopedClientId ? { clientId: scopedClientId } : {}),
      },
      include: { client: { select: safeClient } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: contents.map(serializeContent) });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
});

router.get('/:id/publish-status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const jobs = await prisma.publishJob.findMany({
      where: { contentId: String(req.params.id) },
      select: safePublishJob,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: jobs });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  const contentId = String(req.params.id);
  const where = req.auth?.tokenType === 'client' ? { id: contentId, clientId: req.auth.clientId } : { id: contentId };
  if (req.auth?.tokenType !== 'admin' && req.auth?.tokenType !== 'client') throw new AppError(403, 'forbidden', 'Insufficient permissions');
  const content = await prisma.content.findFirst({
    where,
    include: { assets: true, client: { select: safeClient }, publishJobs: { select: safePublishJob } },
  });

  if (!content) {
    res.status(404).json({ success: false, error: 'Content not found' });
    return;
  }

  res.json({ success: true, data: serializeContent(content) });
});

router.post('/:id/deliver', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    await prisma.$transaction((tx) => transitionContent(tx, id, ['approved', 'failed'], 'delivered'));
    const content = await prisma.content.findUnique({ where: { id }, include: { client: { select: safeClient } } });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');

    await writeAudit({
      action: 'delivered',
      actorType: 'system',
      targetType: 'content',
      targetId: content.id,
      details: 'Delivered to client',
    });

    res.json({ success: true, data: serializeContent(content) });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
});

router.post('/:id/confirm', authenticateToken, requireClient, async (req, res) => {
  try {
    const { clientId, deviceId } = req.body;
    const scopedClientId = clientIdFromAuth(req, clientId)!;

    const existing = await prisma.content.findFirst({ where: { id: String(req.params.id), clientId: scopedClientId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Content not found' });
      return;
    }

    const binding = await prisma.accountBinding.findFirst({
      where: {
        clientId: scopedClientId,
        platform: 'tiktok',
        active: true,
        status: 'active',
        accessToken: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!binding) {
      res.status(400).json({
        success: false,
        error: 'No TikTok account connected. Please bind a TikTok account in Dashboard first.',
      });
      return;
    }

    const { job, created } = await prisma.$transaction((tx) => createOrGetActivePublishJob(tx, {
      contentId: existing.id, accountBindingId: binding.id, platform: 'tiktok', dispatchWhenImmediate: false,
      changedBy: scopedClientId, createdNotes: 'Server publishing requested by client',
      auditOnCreate: (jobId) => ({
        action: 'publish_requested', actorType: 'client', targetType: 'content', targetId: existing.id,
        actorId: scopedClientId, deviceId, details: JSON.stringify({ jobId, bindingId: binding.id }),
      }),
    }));
    const content = await prisma.content.findUnique({ where: { id: existing.id }, include: { client: { select: safeClient } } });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');
    if (created) {
      publishToTikTok(job.id).catch((error) => console.error(`TikTok publish job ${job.id} failed`, error));
    }

    res.json({
      success: true,
      data: {
        ...serializeContent(content),
        publishing: true,
        publishJobId: job.id,
        idempotent: !created,
        message: 'Publishing to TikTok',
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
});

router.post('/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  await prisma.$transaction((tx) => transitionContent(tx, id, ['draft', 'pending_review', 'rejected'], 'approved'));
  const content = await prisma.content.findUnique({ where: { id }, include: { assets: true, client: { select: safeClient } } });
  if (!content) throw new AppError(404, 'not_found', 'Content not found');

  await writeAudit({
    action: 'approve_content',
    actorType: 'dashboard',
    targetType: 'content',
    targetId: content.id,
    details: JSON.stringify({ previous_status: 'pending_review' }),
  });

  res.json({ success: true, data: serializeContent(content) });
});

router.post('/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  const { reason, detail } = req.body;
  const id = String(req.params.id);
  await prisma.$transaction((tx) => transitionContent(tx, id, ['draft', 'pending_review'], 'rejected'));
  const content = await prisma.content.findUnique({ where: { id }, include: { client: { select: safeClient } } });
  if (!content) throw new AppError(404, 'not_found', 'Content not found');

  await writeAudit({
    action: 'reject_content',
    actorType: 'dashboard',
    targetType: 'content',
    targetId: content.id,
    details: JSON.stringify({ reason, detail }),
  });

  res.json({ success: true, data: serializeContent(content) });
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await prisma.content.delete({ where: { id: String(req.params.id) } });
    await writeAudit({
      action: 'delete_content',
      actorType: 'dashboard',
      targetType: 'content',
      targetId: String(req.params.id),
    });
    res.json({ success: true });
  } catch (error) {
    sendInternalError(req, res);
  }
});

export default router;
