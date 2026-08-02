import { AppError } from '../middleware/errors';

export const TIKTOK_CAPTION_MAX_UTF16_UNITS = 2200;
export const TIKTOK_INBOX_AI_DISCLOSURE_METHOD = 'customer_confirms_in_tiktok_app';
export const TIKTOK_INBOX_TEXT_TRANSFER = 'not_supported_by_tiktok_video_upload_api';

type CaptionSource = {
  caption: string | null;
  description: string;
  hashtags: string;
  aiGenerated: boolean;
};

type CaptionHandoffSource = {
  caption?: string | null;
  hashtags?: unknown;
};

function hashtagValues(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((value) => String(value));
    if (typeof parsed === 'string') return [parsed];
  } catch {
    // Legacy rows may contain a whitespace/comma separated string.
  }

  return trimmed.split(/[\s,]+/u);
}

/**
 * Normalizes Content.hashtags for the manual Inbox handoff. Unlike the
 * delivery validator this deliberately tolerates malformed legacy values so a
 * queue read remains safe and read-only for old Content rows.
 */
function handoffHashtagValues(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap((value) => handoffHashtagValues(value));
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== raw) return handoffHashtagValues(parsed);
  } catch {
    // Older rows may use plain comma/whitespace separated tags.
  }

  return trimmed.split(/[\s,]+/u);
}

export type TikTokCaptionHandoff = {
  body: string;
  hashtags: string[];
  text: string;
  hasContent: boolean;
};

/**
 * Produces exactly the text an operator must paste after Inbox Upload. It is
 * intentionally independent of upload/OAuth/account-binding concerns.
 */
export function composeTikTokCaption(source: CaptionHandoffSource): TikTokCaptionHandoff {
  const body = typeof source.caption === 'string' ? source.caption.trim() : '';
  const seen = new Set<string>();
  const hashtags: string[] = [];

  for (const candidate of handoffHashtagValues(source.hashtags)) {
    const name = candidate.trim().replace(/^#+/u, '');
    if (!name || !/^[\p{L}\p{M}\p{N}_]+$/u.test(name)) continue;
    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    hashtags.push(`#${name}`);
  }

  const hashtagText = hashtags.join(' ');
  const text = body && hashtagText ? `${body}\n\n${hashtagText}` : body || hashtagText;
  return { body, hashtags, text, hasContent: Boolean(text) };
}

export function normalizeHashtags(raw: string): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of hashtagValues(raw)) {
    const name = value.trim().replace(/^#+/u, '');
    if (!name) continue;
    if (!/^[\p{L}\p{M}\p{N}_]+$/u.test(name)) {
      throw new AppError(422, 'invalid_hashtag', `Hashtag "${name.slice(0, 40)}" contains unsupported whitespace or punctuation`);
    }

    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(`#${name}`);
  }

  return normalized;
}

function deduplicateCaptionHashtags(caption: string): { caption: string; seen: Set<string> } {
  const seen = new Set<string>();
  const deduplicated = caption.replace(/#[\p{L}\p{M}\p{N}_]+/gu, (tag) => {
    const key = tag.slice(1).toLocaleLowerCase('en-US');
    if (seen.has(key)) return '';
    seen.add(key);
    return tag;
  });

  return {
    caption: deduplicated
      .replace(/[ \t]{2,}/gu, ' ')
      .replace(/[ \t]+\n/gu, '\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim(),
    seen,
  };
}

export function buildTikTokDeliveryContract(content: CaptionSource): {
  finalCaption: string;
  hashtags: string[];
  aiDisclosureRequired: boolean;
  aiDisclosureMethod: string;
  textTransfer: string;
} {
  const base = (content.caption || content.description || '').trim();
  if (!base) throw new AppError(422, 'tiktok_caption_required', 'A final TikTok caption is required');

  const captionHashtags = deduplicateCaptionHashtags(base);
  const configuredHashtags = normalizeHashtags(content.hashtags);
  const missingHashtags = configuredHashtags.filter((tag) => {
    const key = tag.slice(1).toLocaleLowerCase('en-US');
    if (captionHashtags.seen.has(key)) return false;
    captionHashtags.seen.add(key);
    return true;
  });
  const finalCaption = [captionHashtags.caption, missingHashtags.join(' ')].filter(Boolean).join('\n');

  if (finalCaption.length > TIKTOK_CAPTION_MAX_UTF16_UNITS) {
    throw new AppError(
      422,
      'tiktok_caption_too_long',
      `Final TikTok caption exceeds ${TIKTOK_CAPTION_MAX_UTF16_UNITS} UTF-16 code units`,
    );
  }

  return {
    finalCaption,
    hashtags: [...captionHashtags.seen].map((name) => `#${name}`),
    aiDisclosureRequired: content.aiGenerated,
    aiDisclosureMethod: TIKTOK_INBOX_AI_DISCLOSURE_METHOD,
    textTransfer: TIKTOK_INBOX_TEXT_TRANSFER,
  };
}
