import { afterEach, describe, expect, it } from 'vitest';
import { loadHttpSecurityConfig, loadMediaConfig } from '../src/config/security';
import { detectMedia, normalizeLocalStorageKey } from '../src/services/media-storage';
import { isUnsafeAddress } from '../src/services/safe-http-fetch';
import { InMemoryRateLimitStore } from '../src/middleware/http-security';

describe('Phase 1C input boundary primitives', () => {
  afterEach(() => { delete process.env.MEDIA_SIGNING_SECRET; });
  it('fails closed for an undersized media secret and validates explicit media settings', () => {
    expect(() => loadMediaConfig({ NODE_ENV: 'production', MEDIA_SIGNING_SECRET: 'short', PUBLIC_BASE_URL: 'https://api.test' })).toThrow('32 bytes');
    expect(loadMediaConfig({ NODE_ENV: 'test', MEDIA_ROOT: '/tmp/media', PUBLIC_BASE_URL: 'https://api.test' }).ttlSeconds).toBe(900);
  });
  it('uses content signatures rather than filename or MIME claims', () => {
    expect(detectMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(detectMedia(Buffer.from('not a video'))).toBeUndefined();
  });
  it('rejects traversal and preserves stable local keys', () => {
    expect(normalizeLocalStorageKey('local:videos/a.mp4')).toBe('local:videos/a.mp4');
    expect(normalizeLocalStorageKey('/uploads/videos/a.mp4')).toBe('local:videos/a.mp4');
    expect(normalizeLocalStorageKey('local:videos/../secret')).toBeUndefined();
    expect(normalizeLocalStorageKey('local:%2e%2e/secret')).toBeUndefined();
  });
  it('rejects private, reserved, and mapped private addresses before connecting', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isUnsafeAddress(address)).toBe(true);
    expect(isUnsafeAddress('8.8.8.8')).toBe(false);
  });
  it('only accepts exact origins and has an expiring rate-limit store', () => {
    expect(loadHttpSecurityConfig({ CORS_ALLOWED_ORIGINS: 'https://trusted.example' }).allowedOrigins).toEqual(['https://trusted.example']);
    expect(() => loadHttpSecurityConfig({ CORS_ALLOWED_ORIGINS: 'https://trusted.example/path' })).toThrow();
    const store = new InMemoryRateLimitStore();
    expect(store.check('client-a', 1, 1000, 0).allowed).toBe(true);
    expect(store.check('client-a', 1, 1000, 1).allowed).toBe(false);
    expect(store.check('client-a', 1, 1000, 1001).allowed).toBe(true);
  });
});
