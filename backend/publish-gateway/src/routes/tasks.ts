import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateUser, authenticateTaskToken, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /tasks/:id/status - client app reports publish result
router.post('/:id/status', authenticateTaskToken, async (req: AuthRequest, res) => {
  const { status, platform_post_id, platform_post_url, published_at, error, device_fingerprint, screenshot_url } = req.body;
  
  const jobId = req.params.id as string;
  const tokenJobId = (req.user as any)?.job_id;
  
  // Ensure task token matches the job
  if (tokenJobId !== jobId) {
    res.status(403).json({ error: 'Task token does not match job' });
    return;
  }
  
  const job = await prisma.publishJob.findUnique({ where: { id: jobId } });
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  
  let updateData: any = {
    status,
    updatedAt: new Date(),
  };
  
  if (status === 'published') {
    updateData.platformPostId = platform_post_id;
    updateData.platformPostUrl = platform_post_url;
    updateData.publishedAt = published_at ? new Date(published_at) : new Date();
    updateData.deviceFingerprint = device_fingerprint;
    updateData.screenshotUrl = screenshot_url;
    
    // Update content status too
    await prisma.content.update({
      where: { id: job.contentId },
      data: { status: 'published' }
    });
  } else if (status === 'failed') {
    updateData.errorCode = error?.code;
    updateData.errorDetail = error?.message;
    updateData.failedAt = new Date();
    updateData.retryable = error?.retryable ?? false;
    updateData.deviceFingerprint = device_fingerprint;
  }
  
  const updated = await prisma.publishJob.update({
    where: { id: jobId },
    data: updateData,
    include: { content: true, accountBinding: true }
  });
  
  // Record history
  await prisma.jobHistory.create({
    data: {
      jobId: jobId,
      status,
      changedBy: 'client_app',
      notes: error?.message || `Status updated to ${status}`
    }
  });
  
  res.json({
    job_id: updated.id,
    status: updated.status,
    content_id: updated.contentId,
    platform: updated.platform,
    updated_at: updated.updatedAt,
  });
});

// GET /tasks/:id - get job details (user auth)
router.get('/:id', authenticateUser, async (req: AuthRequest, res) => {
  const job = await prisma.publishJob.findUnique({
    where: { id: req.params.id as string },
    include: {
      content: { include: { assets: true } },
      accountBinding: true,
      history: { orderBy: { changedAt: 'desc' } }
    }
  });
  
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  
  res.json(job);
});

export default router;