import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateUser, AuthRequest } from '../middleware/auth';

const router = Router();

const createJobSchema = z.object({
  content_id: z.string(),
  account_binding_id: z.string(),
  platform: z.string(),
  schedule_at: z.string().datetime().optional(),
  publish_options: z.record(z.any()).optional(),
});

// POST /publish-jobs - create a publish job for approved content
router.post('/', authenticateUser, async (req: AuthRequest, res) => {
  const parse = createJobSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(422).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;

  // Validate content is approved
  const content = await prisma.content.findUnique({
    where: { id: data.content_id }
  });
  
  if (!content) {
    res.status(404).json({ error: 'Content not found' });
    return;
  }
  
  if (content.status !== 'approved') {
    res.status(422).json({ error: 'Content must be approved before creating publish jobs' });
    return;
  }

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

  const job = await prisma.publishJob.create({
    data: {
      contentId: data.content_id,
      accountBindingId: data.account_binding_id,
      platform: data.platform,
      scheduleAt: data.schedule_at ? new Date(data.schedule_at) : null,
      publishOptions: data.publish_options || {},
      status: 'pending',
    },
    include: { content: true, accountBinding: true }
  });

  // Auto-dispatch if schedule is immediate (or within 5 min)
  if (!data.schedule_at || new Date(data.schedule_at).getTime() - Date.now() < 5 * 60000) {
    await prisma.publishJob.update({
      where: { id: job.id },
      data: { status: 'dispatched' }
    });
    job.status = 'dispatched';
  }

  await prisma.jobHistory.create({
    data: {
      jobId: job.id,
      status: job.status,
      changedBy: req.user!.id,
      notes: 'Job created'
    }
  });

  await prisma.auditLog.create({
    data: {
      action: 'create_publish_job',
      actorId: req.user!.id,
      actorType: 'user',
      targetType: 'publish_job',
      targetId: job.id,
      details: { content_id: data.content_id, platform: data.platform }
    }
  });

  res.status(201).json({
    job_id: job.id,
    status: job.status,
    content_id: job.contentId,
    platform: job.platform,
    account_binding_id: job.accountBindingId,
    created_at: job.createdAt,
  });
});

// GET /publish-jobs - list jobs
router.get('/', authenticateUser, async (req: AuthRequest, res) => {
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
router.post('/:id/cancel', authenticateUser, async (req: AuthRequest, res) => {
  const job = await prisma.publishJob.findUnique({ where: { id: req.params.id as string } });
  
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  
  if (['published', 'failed'].includes(job.status)) {
    res.status(422).json({ error: 'Cannot cancel job that is already completed or failed' });
    return;
  }

  const updated = await prisma.publishJob.update({
    where: { id: req.params.id as string },
    data: { status: 'cancelled' }
  });

  await prisma.jobHistory.create({
    data: {
      jobId: updated.id,
      status: 'cancelled',
      changedBy: req.user!.id,
      notes: 'Job cancelled by user'
    }
  });

  res.json({ job_id: updated.id, status: updated.status });
});

export default router;
