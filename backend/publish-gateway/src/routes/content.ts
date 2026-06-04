import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateUser, AuthRequest } from '../middleware/auth';

const router = Router();

const createContentSchema = z.object({
  client_id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  video_url: z.string().url(),
  thumbnail_url: z.string().url().optional(),
  ai_generated: z.boolean().default(false),
  ai_tools: z.array(z.string()).optional(),
  platforms: z.array(z.string()).min(1),
  schedule_at: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional(),
  assets: z.array(z.object({
    type: z.string(),
    source: z.string().optional(),
    license_id: z.string().optional(),
    url: z.string().url(),
    authorization_doc_url: z.string().url().optional(),
    description: z.string().optional(),
  })).optional(),
});

router.post('/', authenticateUser, async (req: AuthRequest, res) => {
  const parse = createContentSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(422).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;
  
  // Validate client exists
  const client = await prisma.client.findUnique({ where: { id: data.client_id } });
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  // Check license chain completeness
  if (data.assets) {
    const missingLicense = data.assets.filter(a => 
      a.type === 'stock_video' && !a.license_id
    );
    if (missingLicense.length > 0) {
      res.status(422).json({ 
        error: 'License reference required for stock assets',
        assets: missingLicense.map(a => a.url)
      });
      return;
    }
  }

  const content = await prisma.content.create({
    data: {
      clientId: data.client_id,
      title: data.title,
      description: data.description,
      caption: data.caption,
      hashtags: data.hashtags || [],
      videoUrl: data.video_url,
      thumbnailUrl: data.thumbnail_url,
      aiGenerated: data.ai_generated,
      aiTools: data.ai_tools || [],
      platforms: data.platforms,
      scheduleAt: data.schedule_at ? new Date(data.schedule_at) : null,
      metadata: data.metadata,
      status: 'pending_review',
      assets: {
        create: (data.assets || []).map(a => ({
          type: a.type,
          source: a.source,
          licenseId: a.license_id,
          url: a.url,
          authorizationDocUrl: a.authorization_doc_url,
          description: a.description,
        }))
      }
    },
    include: { assets: true }
  });

  await prisma.auditLog.create({
    data: {
      action: 'create_content',
      actorId: req.user!.id,
      actorType: 'user',
      targetType: 'content',
      targetId: content.id,
      details: { title: data.title, client_id: data.client_id }
    }
  });

  res.status(201).json({
    content_id: content.id,
    status: content.status,
    created_at: content.createdAt,
    compliance_check: {
      status: 'pending',
      checks: ['copyright', 'ai_disclosure', 'platform_policy']
    }
  });
});

router.get('/', authenticateUser, async (req: AuthRequest, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : undefined;
  
  const contents = await prisma.content.findMany({
    where: {
      ...(status && { status: status as any }),
      ...(clientId && { clientId }),
    },
    include: { assets: true, publishJobs: { include: { accountBinding: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({ data: contents });
});

router.get('/:id', authenticateUser, async (req: AuthRequest, res) => {
  const content = await prisma.content.findUnique({
    where: { id: req.params.id as string },
    include: { assets: true, publishJobs: { include: { accountBinding: true } } }
  });
  
  if (!content) {
    res.status(404).json({ error: 'Content not found' });
    return;
  }
  
  res.json(content);
});

router.post('/:id/approve', authenticateUser, async (req: AuthRequest, res) => {
  const { notes } = req.body;
  
  const content = await prisma.content.update({
    where: { id: req.params.id as string },
    data: { status: 'approved' },
    include: { assets: true }
  });

  await prisma.auditLog.create({
    data: {
      action: 'approve_content',
      actorId: req.user!.id,
      actorType: 'user',
      targetType: 'content',
      targetId: content.id,
      details: { notes, previous_status: 'pending_review' }
    }
  });

  res.json({ content_id: content.id, status: content.status, approved_at: new Date() });
});

router.post('/:id/reject', authenticateUser, async (req: AuthRequest, res) => {
  const { reason, detail } = req.body;
  const id = req.params.id as string;
  
  const content = await prisma.content.update({
    where: { id },
    data: { status: 'rejected' },
  });

  await prisma.auditLog.create({
    data: {
      action: 'reject_content',
      actorId: req.user!.id,
      actorType: 'user',
      targetType: 'content',
      targetId: content.id,
      details: { reason, detail }
    }
  });

  res.json({ content_id: content.id, status: content.status, rejected_at: new Date() });
});

export default router;
