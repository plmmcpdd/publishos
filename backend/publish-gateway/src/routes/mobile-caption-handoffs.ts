import { Router, type RequestHandler, type Response } from 'express';
import { authenticateToken, clientIdFromAuth, requireClient } from '../middleware/auth';
import { rateLimit } from '../middleware/http-security';
import {
  createMobileCaptionHandoff,
  resolveMobileCaptionHandoff,
  revokeMobileCaptionHandoff,
} from '../services/mobile-caption-handoff';

const router = Router();

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

function sendSnapshot(res: Response, snapshot: Awaited<ReturnType<typeof resolveMobileCaptionHandoff>>) {
  res.json({
    title: snapshot.title,
    targetTikTokAccount: snapshot.targetTikTokAccount,
    caption: snapshot.caption,
    hashtags: snapshot.hashtags,
    captionText: snapshot.captionText,
    expiresAt: snapshot.expiresAt.toISOString(),
  });
}

router.post(
  '/mobile-caption-handoffs/resolve',
  noStore,
  rateLimit('mobile_caption_handoff_resolve', 30, 10 * 60_000),
  async (req, res) => {
    const snapshot = await resolveMobileCaptionHandoff(req.body?.token);
    sendSnapshot(res, snapshot);
  },
);

router.post(
  '/content/:id/mobile-caption-handoffs',
  noStore,
  authenticateToken,
  requireClient,
  rateLimit('mobile_caption_handoff_create', 30, 60 * 60_000),
  async (req, res) => {
    const clientId = clientIdFromAuth(req)!;
    const created = await createMobileCaptionHandoff({ clientId, contentId: String(req.params.id) });
    res.status(201).json({
      handoffId: created.handoffId,
      url: created.url,
      expiresAt: created.expiresAt.toISOString(),
    });
  },
);

router.delete(
  '/mobile-caption-handoffs/:handoffId',
  noStore,
  authenticateToken,
  requireClient,
  rateLimit('mobile_caption_handoff_revoke', 60, 60 * 60_000),
  async (req, res) => {
    await revokeMobileCaptionHandoff({
      clientId: clientIdFromAuth(req)!,
      handoffId: String(req.params.handoffId),
    });
    res.status(204).end();
  },
);

export default router;
