import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { issueToken } from './auth';
import { authenticateToken, clientIdFromAuth, requireAdmin, requireClient, requireDevice } from '../middleware/auth';
import { AppError, sendInternalError } from '../middleware/errors';
import { transitionJob } from '../domain/publishing-state';
import { signedMediaUrl } from '../services/media-signing';

const router = Router();

router.get('/', authenticateToken, requireAdmin, async (_req, res) => {
  const clients = await prisma.client.findMany({
    select: { id: true, name: true, email: true, industry: true, active: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json({ success: true, data: clients });
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, industry } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ success: false, error: 'Name, email, password required' });
      return;
    }

    const existing = await prisma.client.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, error: 'Email already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const client = await prisma.client.create({
      data: { name, email, password: hashedPassword, industry },
      select: { id: true, name: true, email: true, industry: true, active: true, createdAt: true, updatedAt: true },
    });

    res.json({ success: true, data: client });
  } catch (error) {
    sendInternalError(req, res);
  }
});

// GET /client/list - list all active clients (for client app selection)
router.get('/list', authenticateToken, requireAdmin, async (_req, res) => {
  const clients = await prisma.client.findMany({
    where: { active: true },
    select: { id: true, name: true, industry: true },
    orderBy: { name: 'asc' },
  });
  res.json({ data: clients });
});

// POST /client/register - device registration (called by Electron app on first run)
router.post('/register', authenticateToken, requireClient, async (req, res) => {
  const { device_id, client_id, capabilities } = req.body;
  const clientId = clientIdFromAuth(req, client_id)!;
  
  if (!device_id) {
    res.status(400).json({ error: 'device_id required' });
    return;
  }
  const existingDevice = await prisma.device.findUnique({
    where: { deviceId: device_id },
    select: { clientId: true },
  });
  if (existingDevice?.clientId && existingDevice.clientId !== clientId) {
    throw new AppError(409, 'device_tenant_mismatch', 'Device is already registered to another customer');
  }

  const token = issueToken({ tokenType: 'device', sub: device_id, deviceId: device_id, clientId, role: 'device' }, '7d');

  const device = await prisma.device.upsert({
    where: { deviceId: device_id },
    update: {
      clientId,
      capabilities: JSON.stringify(capabilities || []),
      token,
      online: true,
      lastSeen: new Date(),
    },
    create: {
      deviceId: device_id,
      clientId,
      capabilities: JSON.stringify(capabilities || []),
      token,
      online: true,
    }
  });

  res.json({ device_token: token, device_id: device.deviceId });
});

// GET /client/queue - poll for pending publish jobs
router.get('/queue', authenticateToken, requireDevice, async (req, res) => {
  const auth = req.auth;
  if (!auth || auth.tokenType !== 'device') throw new AppError(403, 'forbidden', 'Insufficient permissions');
  const { deviceId, clientId } = auth;
  
  // Update heartbeat
  const heartbeat = await prisma.device.updateMany({
    where: { deviceId, clientId },
    data: { lastSeen: new Date(), online: true }
  });
  if (heartbeat.count !== 1) throw new AppError(403, 'device_tenant_mismatch', 'Device registration does not match token');

  // Find jobs for this client's active account bindings
  const jobs = await prisma.publishJob.findMany({
    where: {
      OR: [
        { status: 'dispatched' },
        { status: 'client_confirmed', taskTokenConsumedAt: null, taskTokenExpiresAt: { lt: new Date() } },
      ],
      accountBinding: {
        clientId,
        active: true,
      },
      content: { clientId },
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
    const taskToken = issueToken({ tokenType: 'task', sub: job.id, jobId: job.id, deviceId, clientId, role: 'task' }, '24h');
    const decoded = JSON.parse(Buffer.from(taskToken.split('.')[1], 'base64url').toString('utf8')) as { jti: string; exp: number };
    const claimed = await prisma.$transaction(async (tx) => {
      const current = await tx.publishJob.findUnique({ where: { id: job.id } });
      if (!current) return false;
      const tokenData = {
        taskTokenJti: decoded.jti,
        taskTokenExpiresAt: new Date(decoded.exp * 1000),
        taskTokenConsumedAt: null,
        taskDeviceId: deviceId,
        jobToken: null,
        clientToken: null,
      };
      if (current.status === 'dispatched') {
        await transitionJob(tx, job.id, 'dispatched', 'client_confirmed', tokenData);
      } else if (current.status === 'client_confirmed' && !current.taskTokenConsumedAt && current.taskTokenExpiresAt && current.taskTokenExpiresAt < new Date()) {
        const updated = await tx.publishJob.updateMany({ where: { id: job.id, status: 'client_confirmed', taskTokenConsumedAt: null, taskTokenExpiresAt: { lt: new Date() } }, data: tokenData });
        if (updated.count !== 1) return false;
      } else return false;
      await tx.jobHistory.create({ data: { jobId: job.id, status: 'client_confirmed', changedBy: deviceId, notes: current.status === 'dispatched' ? 'Task claimed by device' : 'Expired task token reissued' } });
      return true;
    });
    if (!claimed) return null;

    return {
      job_id: job.id,
      job_token: taskToken,
      content_id: job.contentId,
      title: job.content.title,
      description: job.content.description,
      caption: job.content.caption,
      media_url: signedMediaUrl(job.content.videoUrl, `device:${deviceId}:job:${job.id}`).url,
      thumbnail_url: job.content.thumbnailUrl ? signedMediaUrl(job.content.thumbnailUrl, `device:${deviceId}:job:${job.id}`).url : undefined,
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

  res.json({ device_id: deviceId, queue: queue.filter(Boolean) });
});

// POST /client/heartbeat
router.post('/heartbeat', authenticateToken, requireDevice, async (req, res) => {
  const auth = req.auth;
  if (!auth || auth.tokenType !== 'device') throw new AppError(403, 'forbidden', 'Insufficient permissions');
  const { deviceId } = auth;
  const { status, capabilities, active_sessions } = req.body;
  
  const heartbeat = await prisma.device.updateMany({
    where: { deviceId, clientId: auth.clientId },
    data: {
      lastSeen: new Date(),
      online: status === 'online',
      capabilities: JSON.stringify(capabilities || []),
    }
  });
  if (heartbeat.count !== 1) throw new AppError(403, 'device_tenant_mismatch', 'Device registration does not match token');

  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// PUT /client/:id — update client
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, email, industry, active } = req.body;
    const data: { name?: string; email?: string; industry?: string; active?: boolean } = {};
    if (name) data.name = name;
    if (email) data.email = email;
    if (industry !== undefined) data.industry = industry;
    if (active !== undefined) data.active = active;

    const client = await prisma.client.update({
      where: { id: String(req.params.id) },
      data,
      select: { id: true, name: true, email: true, industry: true, active: true, createdAt: true, updatedAt: true },
    });

    res.json({ success: true, data: client });
  } catch (error) {
    sendInternalError(req, res);
  }
});

// PUT /client/:id/password — reset password
router.put('/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      res.status(400).json({ success: false, error: 'Password required' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.client.update({ where: { id: String(req.params.id) }, data: { password: hashedPassword } });
    res.json({ success: true, message: 'Password updated' });
  } catch (error) {
    sendInternalError(req, res);
  }
});

// DELETE /client/:id — delete client
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await prisma.client.delete({ where: { id: String(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    sendInternalError(req, res);
  }
});

export default router;
