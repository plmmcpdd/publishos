import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authenticateDevice, AuthRequest } from '../middleware/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const PRESIGN_EXPIRY_SECONDS = 900; // 15 minutes

const router = Router();

router.get('/', async (_req, res) => {
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json({ success: true, data: clients });
});

// Helper: generate presigned S3 URL (mock - replace with real S3 SDK)
function generatePresignedUrl(s3Key: string): string {
  // TODO: Replace with actual AWS SDK getSignedUrl
  const bucket = process.env.S3_BUCKET || 'publish-gateway-assets';
  return `https://${bucket}.s3.amazonaws.com/${s3Key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=${PRESIGN_EXPIRY_SECONDS}&X-Amz-SignedHeaders=host`;
}

// POST /client/register - device registration (called by Electron app on first run)
router.post('/register', async (req, res) => {
  const { device_id, client_id, capabilities } = req.body;
  
  if (!device_id) {
    res.status(400).json({ error: 'device_id required' });
    return;
  }

  const token = jwt.sign(
    { type: 'device', device_id, client_id, capabilities },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  const device = await prisma.device.upsert({
    where: { deviceId: device_id },
    update: {
      clientId: client_id,
      capabilities: capabilities || [],
      token,
      online: true,
      lastSeen: new Date(),
    },
    create: {
      deviceId: device_id,
      clientId: client_id,
      capabilities: capabilities || [],
      token,
      online: true,
    }
  });

  res.json({ device_token: token, device_id: device.deviceId });
});

// GET /client/queue - poll for pending publish jobs
router.get('/queue', authenticateDevice, async (req: AuthRequest, res) => {
  const deviceId = req.user!.device_id;
  const clientId = req.user!.client_id;
  
  // Update heartbeat
  await prisma.device.update({
    where: { deviceId },
    data: { lastSeen: new Date(), online: true }
  });

  // Find jobs for this client's active account bindings
  const jobs = await prisma.publishJob.findMany({
    where: {
      status: 'dispatched',
      accountBinding: {
        clientId: clientId || undefined,
        active: true,
      },
    },
    include: {
      content: {
        include: { assets: true }
      },
      accountBinding: true,
    },
    orderBy: { scheduleAt: 'asc' },
    take: 10,
  });

  // Generate presigned URLs and task tokens
  const queue = await Promise.all(jobs.map(async (job) => {
    // Generate one-time task token for this job
    const taskToken = jwt.sign(
      { type: 'task', job_id: job.id, device_id: deviceId },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await prisma.publishJob.update({
      where: { id: job.id },
      data: { jobToken: taskToken, clientToken: req.headers.authorization?.slice(7) }
    });

    return {
      job_id: job.id,
      job_token: taskToken,
      content_id: job.contentId,
      title: job.content.title,
      description: job.content.description,
      caption: job.content.caption,
      media_url: generatePresignedUrl(job.content.videoUrl),
      thumbnail_url: job.content.thumbnailUrl ? generatePresignedUrl(job.content.thumbnailUrl) : undefined,
      platform: job.platform,
      publish_config: {
        ai_generated_label: job.content.aiGenerated,
        privacy: (job.publishOptions as any)?.privacy || 'public',
        allow_comments: (job.publishOptions as any)?.allow_comments ?? true,
        ...(job.publishOptions as any || {})
      },
      account_binding_id: job.accountBindingId,
      account_username: job.accountBinding.accountUsername,
      scheduled_at: job.scheduleAt,
      deadline: job.scheduleAt ? new Date(job.scheduleAt.getTime() + 30 * 60000) : null, // 30min grace
    };
  }));

  res.json({ device_id: deviceId, queue });
});

// POST /client/heartbeat
router.post('/heartbeat', authenticateDevice, async (req: AuthRequest, res) => {
  const deviceId = req.user!.device_id;
  const { status, capabilities, active_sessions } = req.body;
  
  await prisma.device.update({
    where: { deviceId },
    data: {
      lastSeen: new Date(),
      online: status === 'online',
      capabilities: capabilities || [],
    }
  });

  res.json({ ok: true, timestamp: new Date().toISOString() });
});

export default router;
