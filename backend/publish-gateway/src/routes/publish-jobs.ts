import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { createOrGetActivePublishJob, transitionJob } from '../domain/publishing-state';

const router = Router();

const createJobSchema = z.object({
  content_id: z.string(),
  account_binding_id: z.string(),
  platform: z.string(),
  schedule_at: z.string().datetime().optional(),
  publish_options: z.record(z.any()).optional(),
});

// POST /publish-jobs - create a publish job for delivered content
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const parse = createJobSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(422).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;

  // A publication task may only be created after the separate delivery action.
  const content = await prisma.content.findUnique({
    where: { id: data.content_id }
  });
  
  if (!content) {
    res.status(404).json({ error: 'Content not found' });
    return;
  }
  
  if (content.status !== 'delivered') throw new AppError(409, 'invalid_state_transition', 'Content must be delivered before creating publish jobs');

  // Validate account binding
  const binding = await prisma.accountBinding.findUnique({
    where: { id: data.account_binding_id }
  });
  
  if (!binding) {
    res.status(404).json({ error: 'Account binding not found' });
    return;
  }
  
  if (binding.platform !== data.platform) {
    res.status(422).json({ error: 'Account binding platform does not match requested platform' });
    return;
  }
  if (binding.clientId !== content.clientId) {
    res.status(422).json({ error: 'Content and account binding must belong to the same client' });
    return;
  }

  const scheduleAt = data.schedule_at ? new Date(data.schedule_at) : null;
  const { job, created } = await prisma.$transaction((tx) => createOrGetActivePublishJob(tx, {
    contentId: data.content_id, accountBindingId: data.account_binding_id, platform: data.platform, scheduleAt,
    publishOptions: JSON.stringify(data.publish_options || {}), dispatchWhenImmediate: true,
    changedBy: req.auth!.sub,
  }));

  if (created) await prisma.auditLog.create({
    data: {
      action: 'create_publish_job',
      actorId: req.auth!.sub,
      actorType: 'user',
      targetType: 'publish_job',
      targetId: job.id,
      details: JSON.stringify({ content_id: data.content_id, platform: data.platform })
    }
  });

  res.status(created ? 201 : 200).json({
    job_id: job.id,
    status: job.status,
    content_id: job.contentId,
    platform: job.platform,
    account_binding_id: job.accountBindingId,
    created_at: job.createdAt, idempotent: !created,
  });
});

// GET /publish-jobs - list jobs
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  const { status, content_id, platform } = req.query;
  
  const jobs = await prisma.publishJob.findMany({
    where: {
      ...(status && { status: status as any }),
      ...(content_id && { contentId: content_id as string }),
      ...(platform && { platform: platform as string }),
    },
    include: {
      content: { select: { title: true, status: true } },
      accountBinding: { select: { platform: true, accountUsername: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({ data: jobs });
});

// POST /publish-jobs/:id/cancel
router.post('/:id/cancel', authenticateToken, requireAdmin, async (req, res) => {
  const job = await prisma.publishJob.findUnique({ where: { id: req.params.id as string } });
  
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  
  const updated = await prisma.$transaction(async (tx) => {
    await transitionJob(tx, job.id, ['pending', 'dispatched', 'client_confirmed'], 'cancelled');
    return tx.publishJob.findUniqueOrThrow({ where: { id: job.id } });
  });

  await prisma.jobHistory.create({
    data: {
      jobId: updated.id,
      status: 'cancelled',
      changedBy: req.auth!.sub,
      notes: 'Job cancelled by user'
    }
  });

  res.json({ job_id: updated.id, status: updated.status });
});

export default router;
