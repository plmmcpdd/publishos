import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateToken, requireAdmin, requireTask } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { activeJobStatuses, transitionContent, transitionJob } from '../domain/publishing-state';

const router = Router();
const callbackSchema = z.object({
  status: z.enum(['published', 'failed']),
  platform_post_id: z.string().optional(), platform_post_url: z.string().optional(), published_at: z.string().datetime().optional(),
  error: z.object({ code: z.string().optional(), message: z.string().optional(), retryable: z.boolean().optional() }).optional(),
  device_fingerprint: z.string().optional(), screenshot_url: z.string().optional(),
});

router.post('/:id/status', authenticateToken, requireTask, async (req, res) => {
  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(422, 'invalid_request', 'Only published or failed task results are accepted');
  const jobId = String(req.params.id);
  const auth = req.auth;
  if (!auth || auth.tokenType !== 'task') throw new AppError(403, 'forbidden', 'Task token required');
  if (auth.jobId !== jobId) throw new AppError(403, 'forbidden', 'Task token does not match job');
  const body = parsed.data;
  await prisma.$transaction(async (tx) => {
    const job = await tx.publishJob.findUnique({ where: { id: jobId }, include: { content: true, accountBinding: true } });
    if (!job) throw new AppError(404, 'not_found', 'Job not found');
    if (job.platform === 'tiktok') {
      throw new AppError(
        409,
        'official_tiktok_status_required',
        'TikTok completion is accepted only from the official TikTok status API',
      );
    }
    if (job.taskTokenConsumedAt) throw new AppError(409, 'task_token_consumed', 'Task token has already been consumed');
    if (!job.taskTokenExpiresAt || job.taskTokenExpiresAt <= new Date()) throw new AppError(401, 'task_token_expired', 'Task token has expired');
    if (job.taskTokenJti !== auth.jti || job.taskDeviceId !== auth.deviceId || job.content.clientId !== auth.clientId || job.accountBinding.clientId !== auth.clientId) throw new AppError(403, 'forbidden', 'Task token binding does not match job');
    const data = body.status === 'published'
      ? { platformPostId: body.platform_post_id, platformPostUrl: body.platform_post_url, publishedAt: body.published_at ? new Date(body.published_at) : new Date(), deviceFingerprint: body.device_fingerprint, screenshotUrl: body.screenshot_url, taskTokenConsumedAt: new Date() }
      : { errorCode: body.error?.code, errorDetail: body.error?.message, errorMessage: body.error?.message, failedAt: new Date(), retryable: body.error?.retryable ?? false, deviceFingerprint: body.device_fingerprint, taskTokenConsumedAt: new Date() };
    await transitionJob(tx, job.id, activeJobStatuses, body.status, data);
    await transitionContent(tx, job.contentId, 'delivered', body.status, body.status === 'published' ? { publishedAt: new Date() } : {});
    await tx.jobHistory.create({ data: { jobId, status: body.status, changedBy: auth.deviceId, notes: 'Task result callback' } });
    await tx.auditLog.create({ data: { action: `publish_${body.status}`, actorId: auth.deviceId, actorType: 'device', targetType: 'publish_job', targetId: jobId } });
  });
  res.json({ job_id: jobId, status: body.status });
});

router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const job = await prisma.publishJob.findUnique({
    where: { id: String(req.params.id) },
    include: {
      content: { include: { assets: true } },
      accountBinding: {
        select: {
          id: true,
          clientId: true,
          platform: true,
          accountUsername: true,
          platformUserId: true,
          username: true,
          status: true,
          active: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      history: { orderBy: { changedAt: 'desc' } },
    },
  });
  if (!job) throw new AppError(404, 'not_found', 'Job not found');
  res.json(job);
});
export default router;
