import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { publishToTikTok } from '../services/publisher';
import { authenticateToken, clientIdFromAuth, requireAdmin, requireClient } from '../middleware/auth';
import { AppError, sendInternalError } from '../middleware/errors';
import { createOrGetActivePublishJob, transitionContent } from '../domain/publishing-state';
import { signedMediaUrl } from '../services/media-signing';
import { buildTikTokDeliveryContract, composeTikTokCaption } from '../services/tiktok-content';
import { deliveryMessage, deriveDeliveryState } from '../services/publishing-view';
import { contentRefFromAliases } from '../services/content-ref';

const router = Router();
const clientVisibleStatuses = ['delivered', 'failed', 'published'] as const;
const safeClient = { id: true, name: true, email: true, industry: true, active: true, createdAt: true, updatedAt: true } as const;
const safeAccountBinding = {
  // platformUserId is an OAuth-provider identifier, not data the dashboard or
  // client needs in a content response. Keep this selection deliberately safe.
  id: true, clientId: true, platform: true, accountUsername: true,
  username: true, status: true, active: true, expiresAt: true, createdAt: true, updatedAt: true,
} as const;
const safeTargetAccountBinding = {
  id: true, accountUsername: true, username: true, status: true, active: true, reauthorizationRequired: true,
  grantedScopes: true,
} as const;
const safePublishJob = {
  id: true, contentId: true, accountBindingId: true, platform: true, status: true, scheduleAt: true,
  publishId: true, platformPostId: true, platformPostUrl: true, publishedAt: true, failedAt: true,
  errorCode: true, errorMessage: true, retryable: true, retryCount: true, createdAt: true, updatedAt: true,
  deliveryStage: true, sendRequestedAt: true, finalCaption: true, aiDisclosureRequired: true,
  aiDisclosureMethod: true, uploadCompletedAt: true, inboxDeliveredAt: true, lastPlatformStatus: true,
  lastStatusCheckedAt: true, nextStatusCheckAt: true, statusCheckFailures: true, lastStatusError: true,
  accountBinding: { select: safeAccountBinding },
} as const;

const createContentSchema = z.object({
  clientId: z.string().optional(),
  client_id: z.string().optional(),
  targetAccountBindingId: z.string().optional(),
  target_account_binding_id: z.string().optional(),
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
  aiDisclosureConfirmed: z.boolean().optional(),
  ai_disclosure_confirmed: z.boolean().optional(),
  platform: z.string().optional(),
  platforms: z.array(z.string()).optional(),
  scheduleAt: z.string().datetime().optional(),
  schedule_at: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional(),
  contentRef: z.unknown().optional(),
  content_ref: z.unknown().optional(),
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

const sendToTikTokSchema = z.object({
  clientId: z.string().optional(),
  deviceId: z.string().max(200).optional(),
  accountBindingId: z.string().optional(),
  contentConfirmed: z.literal(true),
  aiDisclosureAcknowledged: z.boolean().optional(),
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

function scopes(binding: { grantedScopes?: string | null; scope?: string | null }) {
  try { const parsed = JSON.parse(binding.grantedScopes || '[]'); if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string'); } catch { /* legacy scope below */ }
  return (binding.scope || '').split(/[,\s]+/u).filter(Boolean);
}

async function requireTargetTikTokBinding(clientId: string, bindingId: string | null | undefined, mismatchCode = 'target_tiktok_account_mismatch') {
  if (!bindingId) throw new AppError(422, 'target_tiktok_account_required', 'A target TikTok account is required');
  const binding = await prisma.accountBinding.findUnique({ where: { id: bindingId } });
  if (!binding) throw new AppError(404, 'target_tiktok_account_not_found', 'Target TikTok account was not found');
  if (binding.clientId !== clientId || binding.platform !== 'tiktok') throw new AppError(409, mismatchCode, 'Target TikTok account does not belong to this customer');
  if (!binding.active || binding.status !== 'active' || !binding.accessToken) throw new AppError(409, 'target_tiktok_account_inactive', 'Target TikTok account is inactive');
  if (binding.reauthorizationRequired) throw new AppError(409, 'target_tiktok_reauthorization_required', 'Target TikTok account requires reconnection');
  if (!scopes(binding).includes('video.upload')) throw new AppError(409, 'target_tiktok_scope_missing', 'Target TikTok account does not grant video.upload');
  return binding;
}

function serializeContent(content: any, audience = 'content') {
  if (!content) return content;
  const latestJob = content.publishJobs?.[0];
  let contract: ReturnType<typeof buildTikTokDeliveryContract> | undefined;
  try {
    contract = buildTikTokDeliveryContract(content);
  } catch {
    contract = undefined;
  }
  const handoff = composeTikTokCaption(content);
  const deliveryState = deriveDeliveryState(content, latestJob);
  const video = content.videoUrl ? signedMediaUrl(content.videoUrl, `${audience}:video:${content.id}`).url : null;
  const thumbnail = content.thumbnailUrl
    ? signedMediaUrl(content.thumbnailUrl, `${audience}:thumbnail:${content.id}`).url
    : null;
  return sanitizeContent({
    ...content,
    targetAccountBinding: content.targetAccountBinding ? {
      id: content.targetAccountBinding.id,
      accountUsername: content.targetAccountBinding.accountUsername,
      username: content.targetAccountBinding.username,
      status: content.targetAccountBinding.status,
      active: content.targetAccountBinding.active,
      reauthorizationRequired: content.targetAccountBinding.reauthorizationRequired,
      grantedScopes: scopes(content.targetAccountBinding),
    } : null,
    platform: firstPlatform(content.platforms),
    videoUrl: video,
    thumbnailUrl: thumbnail,
    thumbnail_url: thumbnail,
    hashtags: handoff.hashtags,
    tiktokCaptionText: handoff.text,
    tiktokCaptionHasContent: handoff.hasContent,
    finalCaption: latestJob?.finalCaption || contract?.finalCaption || (content.caption || content.description),
    aiDisclosure: {
      required: latestJob?.aiDisclosureRequired ?? Boolean(content.aiGenerated),
      internalReviewConfirmed: Boolean(content.aiDisclosureConfirmed),
      method: latestJob?.aiDisclosureMethod || contract?.aiDisclosureMethod || 'customer_confirms_in_tiktok_app',
      apiAutomaticallyApplied: false,
      instruction: content.aiGenerated
        ? 'Turn on the AI-generated content label in the TikTok App before the final post.'
        : 'No AI-generated content label is required by PublishOS.',
    },
    deliveryState,
    deliveryMessage: deliveryMessage(deliveryState),
    canRetry: latestJob?.status === 'failed' && Boolean(latestJob.retryable),
    latestPublishJob: latestJob || null,
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
  let contentRef: string | null = null;
  try {
    contentRef = contentRefFromAliases(req.body && typeof req.body === 'object' ? req.body : {}).value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw error;
  }
  const clientId = data.clientId || data.client_id!;
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return;
  }

  const platformList = data.platforms?.length ? data.platforms : [data.platform || 'tiktok'];
  const isTikTok = platformList.includes('tiktok');
  const targetAccountBindingId = data.targetAccountBindingId || data.target_account_binding_id;
  if (isTikTok) await requireTargetTikTokBinding(clientId, targetAccountBindingId);
  const videoUrl = data.videoUrl || data.video_url || (process.env.NODE_ENV === 'test' ? 'mock/video.mp4' : '');
  if (!videoUrl) {
    res.status(422).json({ success: false, error: 'A private uploaded video is required' });
    return;
  }
  const scheduleAt = data.scheduleAt || data.schedule_at;
  const aiGenerated = data.aiGenerated ?? data.ai_generated ?? false;
  const aiDisclosureConfirmed = data.aiDisclosureConfirmed ?? data.ai_disclosure_confirmed ?? false;

  const content = await prisma.content.create({
    data: {
      clientId,
      targetAccountBindingId: isTikTok ? targetAccountBindingId : null,
      contentRef,
      title: data.title,
      description: data.description,
      caption: data.caption,
      hashtags: JSON.stringify(data.hashtags || []),
      videoUrl,
      thumbnailUrl: data.thumbnailUrl || data.thumbnail_url,
      aiGenerated,
      aiTools: JSON.stringify(data.aiTools || data.ai_tools || []),
      platforms: JSON.stringify(platformList),
      scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      status: data.status || 'draft',
      aiDisclosureConfirmed,
      aiDisclosureConfirmedAt: aiDisclosureConfirmed ? new Date() : null,
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
    include: { assets: true, client: { select: safeClient }, targetAccountBinding: { select: safeTargetAccountBinding } },
  });

  await writeAudit({
    action: 'create_content',
    actorType: 'dashboard',
    targetType: 'content',
    targetId: content.id,
    details: JSON.stringify({ title: data.title, clientId, targetAccountBindingId: isTikTok ? targetAccountBindingId : null }),
  });

  res.status(201).json({ success: true, data: serializeContent(content, 'admin') });
});

router.patch('/:contentId/content-ref', authenticateToken, requireAdmin, async (req, res) => {
  const input = contentRefFromAliases(req.body && typeof req.body === 'object' ? req.body : {});
  if (!input.provided) throw new AppError(422, 'invalid_content_ref', 'contentRef is required');
  const contentId = String(req.params.contentId);
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.content.findUnique({ where: { id: contentId }, select: { id: true, contentRef: true } });
    if (!existing) throw new AppError(404, 'not_found', 'Content not found');
    const content = await tx.content.update({
      where: { id: existing.id },
      data: { contentRef: input.value },
      include: { assets: true, client: { select: safeClient } },
    });
    await tx.auditLog.create({
      data: {
        action: 'set_content_ref',
        actorId: req.auth?.sub,
        actorType: 'admin',
        targetType: 'content',
        targetId: existing.id,
        details: JSON.stringify({ contentId: existing.id, oldContentRef: existing.contentRef, newContentRef: input.value }),
      },
    });
    return content;
  });
  res.json({ success: true, data: serializeContent(updated, 'admin') });
});

router.get('/', authenticateToken, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const clientId = typeof req.query.clientId === 'string'
    ? req.query.clientId
    : typeof req.query.client_id === 'string'
      ? req.query.client_id
      : undefined;

  const scopedClientId = clientIdFromAuth(req, clientId);
  const clientRequest = req.auth?.tokenType === 'client';
  const contents = await prisma.content.findMany({
    where: {
      ...(clientRequest
        ? { status: { in: [...clientVisibleStatuses] } }
        : status
          ? { status: statusFilter(status) }
          : {}),
      ...(scopedClientId ? { clientId: scopedClientId } : {}),
    },
    include: { assets: true, client: { select: safeClient }, targetAccountBinding: { select: safeTargetAccountBinding }, publishJobs: { select: safePublishJob, orderBy: { createdAt: 'desc' } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json({
    success: true,
    data: contents.map((content) => serializeContent(content, clientRequest ? `client:${scopedClientId}` : 'admin')),
  });
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
      include: {
        client: { select: safeClient }, targetAccountBinding: { select: safeTargetAccountBinding },
        publishJobs: { select: safePublishJob, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: contents.map((content) => serializeContent(content, `client:${scopedClientId || 'admin'}`)),
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
});

router.get('/:id/publish-status', authenticateToken, async (req, res) => {
  try {
    const contentId = String(req.params.id);
    if (req.auth?.tokenType === 'client') {
      const visible = await prisma.content.findFirst({
        where: { id: contentId, clientId: req.auth.clientId, status: { in: [...clientVisibleStatuses] } },
        select: { id: true },
      });
      if (!visible) throw new AppError(404, 'not_found', 'Content not found');
    } else if (req.auth?.tokenType !== 'admin') {
      throw new AppError(403, 'forbidden', 'Insufficient permissions');
    }
    const jobs = await prisma.publishJob.findMany({
      where: { contentId },
      select: safePublishJob,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: jobs });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
});

router.post('/:id/publish-status/refresh', authenticateToken, async (req, res) => {
  try {
    const contentId = String(req.params.id);
    const where = req.auth?.tokenType === 'client'
      ? { id: contentId, clientId: req.auth.clientId, status: { in: [...clientVisibleStatuses] } }
      : req.auth?.tokenType === 'admin'
        ? { id: contentId }
        : undefined;
    if (!where) throw new AppError(403, 'forbidden', 'Insufficient permissions');
    const content = await prisma.content.findFirst({ where: where as any, select: { id: true } });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');
    const job = await prisma.publishJob.findFirst({
      where: { contentId, platform: 'tiktok', status: { in: ['pending', 'uploading', 'publishing'] } },
      select: safePublishJob,
      orderBy: { createdAt: 'desc' },
    });
    if (!job) throw new AppError(409, 'no_active_publish_job', 'No active TikTok delivery is available to refresh');
    void publishToTikTok(job.id);
    res.status(202).json({ success: true, data: job });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  const contentId = String(req.params.id);
  const where = req.auth?.tokenType === 'client'
    ? { id: contentId, clientId: req.auth.clientId, status: { in: [...clientVisibleStatuses] } }
    : { id: contentId };
  if (req.auth?.tokenType !== 'admin' && req.auth?.tokenType !== 'client') throw new AppError(403, 'forbidden', 'Insufficient permissions');
  const content = await prisma.content.findFirst({
    where: where as any,
    include: {
      assets: true,
      client: { select: safeClient }, targetAccountBinding: { select: safeTargetAccountBinding },
      publishJobs: { select: safePublishJob, orderBy: { createdAt: 'desc' } },
    },
  });

  if (!content) {
    res.status(404).json({ success: false, error: 'Content not found' });
    return;
  }

  res.json({
    success: true,
    data: serializeContent(content, req.auth.tokenType === 'client' ? `client:${req.auth.clientId}` : 'admin'),
  });
});

router.post('/:id/deliver', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const before = await prisma.content.findUnique({ where: { id } });
    if (!before) throw new AppError(404, 'not_found', 'Content not found');
    if (firstPlatform(before.platforms) === 'tiktok') await requireTargetTikTokBinding(before.clientId, before.targetAccountBindingId);
    await prisma.$transaction((tx) => transitionContent(tx, id, 'approved', 'delivered'));
    const content = await prisma.content.findUnique({
      where: { id },
      include: {
        client: { select: safeClient }, targetAccountBinding: { select: safeTargetAccountBinding },
        publishJobs: { select: safePublishJob, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');

    await writeAudit({
      action: 'delivered',
      actorType: 'system',
      targetType: 'content',
      targetId: content.id,
      details: 'Delivered to client',
    });

    res.json({ success: true, data: serializeContent(content, 'admin') });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
});

async function sendToTikTok(req: Request, res: Response): Promise<void> {
  try {
    const parsed = sendToTikTokSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        422,
        'client_confirmation_required',
        'Confirm the content review and AI disclosure instruction before sending to TikTok',
      );
    }
    const { clientId, deviceId, accountBindingId, aiDisclosureAcknowledged } = parsed.data;
    const scopedClientId = clientIdFromAuth(req, clientId)!;
    const existing = await prisma.content.findFirst({
      where: { id: String(req.params.id), clientId: scopedClientId, status: 'delivered' },
    });
    if (!existing) {
      throw new AppError(404, 'not_found', 'Delivered content not found');
    }
    const client = await prisma.client.findUnique({ where: { id: scopedClientId }, select: { active: true } });
    if (!client?.active) throw new AppError(403, 'client_inactive', 'Customer account is inactive');
    const contract = buildTikTokDeliveryContract(existing);
    if (contract.aiDisclosureRequired && !aiDisclosureAcknowledged) {
      throw new AppError(
        422,
        'ai_disclosure_acknowledgement_required',
        'Acknowledge that the AI-generated content label must be confirmed in the TikTok App',
      );
    }

    if (accountBindingId && accountBindingId !== existing.targetAccountBindingId) {
      throw new AppError(409, 'target_account_mismatch', 'Requested TikTok account does not match the content target');
    }
    const binding = await requireTargetTikTokBinding(scopedClientId, existing.targetAccountBindingId);

    const requestedAt = new Date();
    const captionHash = crypto.createHash('sha256').update(contract.finalCaption).digest('hex');
    const { job, created } = await prisma.$transaction(async (tx) => {
      const confirmed = await tx.content.updateMany({
        where: { id: existing.id, clientId: scopedClientId, status: 'delivered', clientConfirmedAt: null },
        data: { clientConfirmedAt: requestedAt, clientConfirmedBy: scopedClientId },
      });
      if (confirmed.count === 1) {
        await tx.auditLog.create({
          data: {
            action: 'client_content_confirmed',
            actorId: scopedClientId,
            actorType: 'client',
            targetType: 'content',
            targetId: existing.id,
            deviceId: deviceId || null,
            details: JSON.stringify({
              captionHash,
              hashtagCount: contract.hashtags.length,
              aiDisclosureRequired: contract.aiDisclosureRequired,
            }),
          },
        });
      }

      return createOrGetActivePublishJob(tx, {
        contentId: existing.id,
        accountBindingId: binding.id,
        platform: 'tiktok',
        dispatchWhenImmediate: false,
        changedBy: scopedClientId,
        createdNotes: 'Customer explicitly requested official TikTok Inbox draft delivery',
        deliveryStage: 'send_requested',
        sendRequestedAt: requestedAt,
        finalCaption: contract.finalCaption,
        aiDisclosureRequired: contract.aiDisclosureRequired,
        aiDisclosureMethod: contract.aiDisclosureMethod,
        auditOnCreate: (jobId) => ({
          action: 'tiktok_send_requested',
          actorType: 'client',
          targetType: 'publish_job',
          targetId: jobId,
          actorId: scopedClientId,
          deviceId,
          details: JSON.stringify({
            contentId: existing.id,
            clientId: scopedClientId,
            targetAccountBindingId: binding.id,
            targetAccountUsername: binding.accountUsername,
            captionHash,
            hashtagCount: contract.hashtags.length,
            aiDisclosureRequired: contract.aiDisclosureRequired,
            aiDisclosureMethod: contract.aiDisclosureMethod,
            textTransfer: contract.textTransfer,
            customerFinalPublishRequired: true,
          }),
        }),
      });
    });
    const content = await prisma.content.findUnique({
      where: { id: existing.id },
      include: {
        client: { select: safeClient },
        publishJobs: { select: safePublishJob, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');
    if (created) {
      void publishToTikTok(job.id);
    }

    res.status(created ? 202 : 200).json({
      success: true,
      data: {
        ...serializeContent(content, `client:${scopedClientId}`),
        publishing: true,
        publishJobId: job.id,
        idempotent: !created,
        message: created
          ? 'Sending the draft to TikTok. You must finish publishing in the TikTok App.'
          : deliveryMessage(deriveDeliveryState(content, content.publishJobs[0])),
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
}

router.post('/:id/send-to-tiktok', authenticateToken, requireClient, (req, res) => {
  return sendToTikTok(req, res);
});

router.post('/:id/confirm', authenticateToken, requireClient, (req, res) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `</v1/content/${req.params.id}/send-to-tiktok>; rel="successor-version"`);
  throw new AppError(
    410,
    'send_to_tiktok_required',
    'The /confirm endpoint is deprecated. Use /send-to-tiktok with explicit contentConfirmed and aiDisclosureAcknowledged.',
  );
});

router.post('/:id/retry-tiktok', authenticateToken, requireClient, async (req, res) => {
  const scopedClientId = clientIdFromAuth(req, req.body?.clientId)!;
  const contentId = String(req.params.id);
  const failed = await prisma.publishJob.findFirst({
    where: {
      contentId,
      content: { clientId: scopedClientId, status: 'failed' },
      status: 'failed',
      retryable: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!failed) throw new AppError(409, 'retry_not_available', 'This TikTok delivery cannot be retried');
  await prisma.$transaction(async (tx) => {
    await transitionContent(tx, contentId, 'failed', 'delivered');
    await tx.auditLog.create({
      data: {
        action: 'tiktok_retry_requested',
        actorId: scopedClientId,
        actorType: 'client',
        targetType: 'publish_job',
        targetId: failed.id,
        details: JSON.stringify({ previousJobId: failed.id, aiDisclosureRequired: failed.aiDisclosureRequired }),
      },
    });
  });
  // Inject the failed job's recorded AI disclosure acknowledgement into the request
  // so the retry inherits the first job's customer confirmation without the client hardcoding it.
  if (failed.aiDisclosureRequired) {
    req.body.aiDisclosureAcknowledged = true;
  }
  req.body.contentConfirmed = true;
  await sendToTikTok(req, res);
});

router.post('/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const review = await prisma.content.findUnique({
    where: { id },
    select: { aiGenerated: true, aiDisclosureConfirmed: true },
  });
  if (!review) throw new AppError(404, 'not_found', 'Content not found');
  if (review.aiGenerated && !review.aiDisclosureConfirmed) {
    throw new AppError(
      409,
      'ai_disclosure_review_required',
      'Confirm the AI disclosure requirement before approving AI-generated content',
    );
  }
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

  res.json({ success: true, data: serializeContent(content, 'admin') });
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

  res.json({ success: true, data: serializeContent(content, 'admin') });
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const contentId = String(req.params.id);
    const content = await prisma.content.findUnique({
      where: { id: contentId },
      select: { status: true, _count: { select: { publishJobs: true } } },
    });
    if (!content) throw new AppError(404, 'not_found', 'Content not found');
    if (!['draft', 'rejected'].includes(content.status) || content._count.publishJobs > 0) {
      throw new AppError(
        409,
        'content_delete_not_allowed',
        'Only draft or rejected content without publish history can be deleted',
      );
    }
    await prisma.content.delete({ where: { id: contentId } });
    await writeAudit({
      action: 'delete_content',
      actorType: 'dashboard',
      targetType: 'content',
      targetId: contentId,
    });
    res.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) throw error;
    sendInternalError(req, res);
  }
});

export default router;
