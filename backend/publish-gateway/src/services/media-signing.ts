import crypto from 'crypto';
import { loadMediaConfig } from '../config/security';
import { AppError } from '../middleware/errors';
import { normalizeLocalStorageKey } from './media-storage';

function payload(key: string, expiresAt: number, audience: string): string { return `v1\n${key}\n${expiresAt}\n${audience}`; }
function signature(value: string): string { return crypto.createHmac('sha256', loadMediaConfig().signingSecret).update(value).digest('base64url'); }

export function signedMediaUrl(reference: string, audience = 'media'): { url: string; expiresAt: Date } {
  const key = normalizeLocalStorageKey(reference);
  if (!key) return { url: reference, expiresAt: new Date(Date.now() + loadMediaConfig().ttlSeconds * 1000) };
  const config = loadMediaConfig();
  const expiresAt = Math.floor(Date.now() / 1000) + config.ttlSeconds;
  const sig = signature(payload(key, expiresAt, audience));
  const url = new URL('/v1/media', config.publicBaseUrl);
  url.searchParams.set('key', key); url.searchParams.set('exp', String(expiresAt)); url.searchParams.set('aud', audience); url.searchParams.set('sig', sig);
  return { url: url.toString(), expiresAt: new Date(expiresAt * 1000) };
}

export function verifyMediaSignature(input: { key?: unknown; exp?: unknown; aud?: unknown; sig?: unknown }): string {
  if (typeof input.key !== 'string' || typeof input.exp !== 'string' || typeof input.aud !== 'string' || typeof input.sig !== 'string') throw new AppError(401, 'invalid_media_signature', 'A valid media signature is required');
  const key = normalizeLocalStorageKey(input.key);
  const exp = /^\d+$/.test(input.exp) ? Number(input.exp) : NaN;
  if (!key || !Number.isSafeInteger(exp) || exp <= 0 || exp > Math.floor(Date.now() / 1000) + 86400) throw new AppError(401, 'invalid_media_signature', 'A valid media signature is required');
  if (exp < Math.floor(Date.now() / 1000)) throw new AppError(401, 'media_url_expired', 'Media URL has expired');
  const expected = Buffer.from(signature(payload(key, exp, input.aud)));
  const actual = Buffer.from(input.sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new AppError(401, 'invalid_media_signature', 'A valid media signature is required');
  return key;
}
