import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { composeTikTokCaption } from './tiktok-content';

export const MOBILE_CAPTION_HANDOFF_TTL_MS = 30 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function mobileCaptionTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function canonicalMobileCaptionOrigin(environment: NodeJS.ProcessEnv = process.env): string {
  const raw = environment.PUBLIC_BASE_URL || '';
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new AppError(500, 'mobile_handoff_not_configured', 'Mobile caption handoff is not configured'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new AppError(500, 'mobile_handoff_not_configured', 'Mobile caption handoff requires a canonical HTTPS origin');
  }
  return parsed.origin;
}

function safeTargetAccount(binding: { accountUsername: string; username: string | null } | null): string | null {
  const value = binding?.username || binding?.accountUsername || '';
  return value.trim() ? `@${value.trim().replace(/^@+/u, '')}` : null;
}

export async function createMobileCaptionHandoff(input: {
  clientId: string;
  contentId: string;
  now?: Date;
}): Promise<{ handoffId: string; url: string; expiresAt: Date }> {
  const now = input.now || new Date();
  const expiresAt = new Date(now.getTime() + MOBILE_CAPTION_HANDOFF_TTL_MS);
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = mobileCaptionTokenHash(rawToken);
  const origin = canonicalMobileCaptionOrigin();

  const record = await prisma.$transaction(async (tx) => {
    const content = await tx.content.findFirst({
      where: { id: input.contentId, clientId: input.clientId, status: 'delivered' },
      select: {
        id: true,
        title: true,
        caption: true,
        hashtags: true,
        targetAccountBinding: { select: { accountUsername: true, username: true } },
      },
    });
    if (!content) throw new AppError(404, 'content_not_found', 'Queue content was not found');

    const snapshot = composeTikTokCaption(content);
    if (!snapshot.hasContent) throw new AppError(422, 'caption_required', 'A copyable caption is required');

    await tx.mobileCaptionHandoff.updateMany({
      where: {
        clientId: input.clientId,
        contentId: content.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    return tx.mobileCaptionHandoff.create({
      data: {
        tokenHash,
        clientId: input.clientId,
        contentId: content.id,
        titleSnapshot: content.title,
        targetAccountSnapshot: safeTargetAccount(content.targetAccountBinding),
        captionSnapshot: snapshot.body || null,
        hashtagsSnapshot: JSON.stringify(snapshot.hashtags),
        captionTextSnapshot: snapshot.text,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });
  });

  return {
    handoffId: record.id,
    url: `${origin}/h/#${rawToken}`,
    expiresAt: record.expiresAt,
  };
}

export async function revokeMobileCaptionHandoff(input: { clientId: string; handoffId: string; now?: Date }): Promise<void> {
  await prisma.mobileCaptionHandoff.updateMany({
    where: { id: input.handoffId, clientId: input.clientId, revokedAt: null },
    data: { revokedAt: input.now || new Date() },
  });
}

export type MobileCaptionSnapshot = {
  title: string;
  targetTikTokAccount: string | null;
  caption: string | null;
  hashtags: string[];
  captionText: string;
  expiresAt: Date;
};

type MobileCaptionHandoffLookup = Pick<typeof prisma.mobileCaptionHandoff, 'findUnique'>;

export async function resolveMobileCaptionHandoff(
  token: unknown,
  now = new Date(),
  lookup: MobileCaptionHandoffLookup = prisma.mobileCaptionHandoff,
): Promise<MobileCaptionSnapshot> {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new AppError(404, 'handoff_not_found', 'Caption handoff is unavailable');
  }

  const record = await lookup.findUnique({
    where: { tokenHash: mobileCaptionTokenHash(token) },
    select: {
      titleSnapshot: true,
      targetAccountSnapshot: true,
      captionSnapshot: true,
      hashtagsSnapshot: true,
      captionTextSnapshot: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!record || record.revokedAt) throw new AppError(404, 'handoff_not_found', 'Caption handoff is unavailable');
  if (record.expiresAt <= now) throw new AppError(410, 'handoff_expired', 'Caption handoff has expired');

  let hashtags: unknown;
  try { hashtags = JSON.parse(record.hashtagsSnapshot); } catch { hashtags = []; }
  const safeHashtags = Array.isArray(hashtags)
    ? hashtags.filter((value): value is string => typeof value === 'string')
    : [];

  return {
    title: record.titleSnapshot,
    targetTikTokAccount: record.targetAccountSnapshot,
    caption: record.captionSnapshot,
    hashtags: safeHashtags,
    captionText: record.captionTextSnapshot,
    expiresAt: record.expiresAt,
  };
}
