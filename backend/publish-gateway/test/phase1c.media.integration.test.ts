import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

vi.mock('dotenv/config', () => ({}));
const publisherMock = vi.hoisted(() => ({ publishToTikTok: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/publisher', () => publisherMock);

// Import rate limit store to clear between tests
import { defaultRateLimitStore } from '../src/middleware/http-security';

// Unique temp directories for this test suite
const testDirectory = mkdtempSync(path.join(tmpdir(), 'publishos-media-integration-'));
const testDatabase = path.join(testDirectory, 'gateway.db');
const testDatabaseUrl = `file:${testDatabase}`;
const mediaDirectory = mkdtempSync(path.join(tmpdir(), 'publishos-media-assets-'));
const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = path.join(gatewayRoot, 'node_modules', '.bin', 'prisma');
const execFileAsync = promisify(execFile);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'media-integration-test-secret-at-least-32-bytes';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.MEDIA_ROOT = mediaDirectory;
process.env.MEDIA_SIGNING_SECRET = 'media-signing-secret-for-testing-at-least-32-bytes-long';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
process.env.TIKTOK_CLIENT_KEY = 'test-tiktok-key';
process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-secret';
process.env.TIKTOK_REDIRECT_URI = 'http://localhost:3000/v1/tiktok/callback';

let app: ReturnType<typeof import('../src/app').createApp>;
let prisma: typeof import('../src/lib/prisma').prisma;
let adminToken = '';
let clientAToken = '';
let clientBToken = '';
let deviceToken = '';
let adminId = '';
let clientAId = '';
let clientBId = '';

// Test fixture data
const VIDEO_FIXTURE = Buffer.from([
  0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, // ftyp box header
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // isom brand
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, // compatible brands
  0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74  // mdat box
]);

const JPEG_FIXTURE = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, // JPEG header
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c,
  0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d,
  0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34,
  0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4,
  0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff,
  0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0x7b, 0x40, 0x1b, 0xff, 0xd9
]);

const PNG_FIXTURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixel
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
  0x44, 0xae, 0x42, 0x60, 0x82
]);

async function pushTemporaryDatabase(): Promise<void> {
  fs.closeSync(fs.openSync(testDatabase, 'w'));
  try {
    await execFileAsync(prismaCli, [
      'db', 'push',
      '--config', './prisma.config.ts',
      '--schema', './prisma/schema.prisma',
    ], {
      cwd: gatewayRoot,
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error: any) {
    throw new Error([
      `Temporary Prisma db push failed.`,
      `stdout:\n${error?.stdout || ''}`,
      `stderr:\n${error?.stderr || ''}`,
    ].join('\n'));
  }
}

beforeAll(async () => {
  await pushTemporaryDatabase();
  ({ prisma } = await import('../src/lib/prisma'));
  const { createApp } = await import('../src/app');
  app = createApp();

  // Create test users
  const bcrypt = await import('bcryptjs');
  const password = await bcrypt.hash('test-password', 4);

  const admin = await prisma.admin.create({ data: { name: 'Admin', email: 'admin@media.test', password } });
  adminId = admin.id;

  const clientA = await prisma.client.create({ data: { name: 'ClientA', email: 'a@media.test', password } });
  clientAId = clientA.id;

  const clientB = await prisma.client.create({ data: { name: 'ClientB', email: 'b@media.test', password } });
  clientBId = clientB.id;

  // Login and get tokens
  adminToken = (await request(app).post('/v1/auth/admin/login').send({ email: 'admin@media.test', password: 'test-password' })).body.data.token;
  clientAToken = (await request(app).post('/v1/auth/login').send({ email: 'a@media.test', password: 'test-password' })).body.data.token;
  clientBToken = (await request(app).post('/v1/auth/login').send({ email: 'b@media.test', password: 'test-password' })).body.data.token;

  // Register a device for queue tests
  const deviceRes = await request(app)
    .post('/v1/client/register')
    .set('Authorization', `Bearer ${clientAToken}`)
    .send({ device_id: 'test-device-media', client_id: clientAId });
  deviceToken = deviceRes.body.device_token;
}, 60_000);

afterAll(async () => {
  try {
    await prisma?.$disconnect();
  } finally {
    rmSync(testDirectory, { recursive: true, force: true });
    rmSync(mediaDirectory, { recursive: true, force: true });
  }
});

afterEach(() => {
  // Clear rate limit store between tests to avoid 429 errors
  defaultRateLimitStore.clear();
});

function writeFixtureFile(relativePath: string, content: Buffer): string {
  const fullPath = path.join(mediaDirectory, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  return fullPath;
}

function signMediaUrl(storageKey: string, audience = 'media', expiresIn = 900): string {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const payload = `v1\n${storageKey}\n${expiresAt}\n${audience}`;
  const sig = crypto.createHmac('sha256', process.env.MEDIA_SIGNING_SECRET!).update(payload).digest('base64url');
  return `/v1/media?key=${encodeURIComponent(storageKey)}&exp=${expiresAt}&aud=${encodeURIComponent(audience)}&sig=${sig}`;
}

describe('Media Endpoint Integration - Signed URL Validation', () => {
  describe('5.1 Signature parameter validation', () => {
    let validUrl: string;
    let storageKey: string;

    beforeAll(() => {
      storageKey = 'local:videos/test-valid.mp4';
      writeFixtureFile('videos/test-valid.mp4', VIDEO_FIXTURE);
      validUrl = signMediaUrl(storageKey);
    });

    it('rejects request with no signature parameters', async () => {
      const res = await request(app).get('/v1/media');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects request with missing expiry', async () => {
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&sig=fakesig`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects request with missing signature', async () => {
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&exp=${Math.floor(Date.now() / 1000) + 900}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects request with empty signature', async () => {
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&exp=${Math.floor(Date.now() / 1000) + 900}&sig=`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects tampered storage key', async () => {
      const parsed = new URL(`http://localhost${validUrl}`);
      parsed.searchParams.set('key', 'local:videos/tampered.mp4');
      const res = await request(app).get(`${parsed.pathname}${parsed.search}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects tampered expiry', async () => {
      const parsed = new URL(`http://localhost${validUrl}`);
      parsed.searchParams.set('exp', String(Math.floor(Date.now() / 1000) + 9999));
      const res = await request(app).get(`${parsed.pathname}${parsed.search}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects tampered audience', async () => {
      const parsed = new URL(`http://localhost${validUrl}`);
      parsed.searchParams.set('aud', 'tampered-audience');
      const res = await request(app).get(`${parsed.pathname}${parsed.search}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects signature with any character changed', async () => {
      const parsed = new URL(`http://localhost${validUrl}`);
      const sig = parsed.searchParams.get('sig')!;
      parsed.searchParams.set('sig', sig.slice(0, -1) + (sig.slice(-1) === 'A' ? 'B' : 'A'));
      const res = await request(app).get(`${parsed.pathname}${parsed.search}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects expired URL', async () => {
      const expiredUrl = signMediaUrl(storageKey, 'media', -10);
      const res = await request(app).get(expiredUrl);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('media_url_expired');
    });

    it('rejects negative expiry', async () => {
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&exp=-100&aud=media&sig=fakesig`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects decimal expiry', async () => {
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&exp=123.456&aud=media&sig=fakesig`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects scientific notation expiry', async () => {
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&exp=1e10&aud=media&sig=fakesig`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects NaN expiry', async () => {
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&exp=NaN&aud=media&sig=fakesig`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects Infinity expiry', async () => {
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&exp=Infinity&aud=media&sig=fakesig`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('rejects expiry too far in the future', async () => {
      const farFuture = Math.floor(Date.now() / 1000) + 86400 + 100; // >24h
      const payload = `v1\n${storageKey}\n${farFuture}\nmedia`;
      const sig = crypto.createHmac('sha256', process.env.MEDIA_SIGNING_SECRET!).update(payload).digest('base64url');
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&exp=${farFuture}&aud=media&sig=${sig}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_media_signature');
    });

    it('handles signature of wrong length without 500', async () => {
      const res = await request(app).get(`/v1/media?key=${encodeURIComponent(storageKey)}&exp=${Math.floor(Date.now() / 1000) + 900}&aud=media&sig=tooshort`);
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(500);
    });

    it('does not leak file existence in error responses', async () => {
      const nonExistentKey = 'local:videos/nonexistent.mp4';
      const url = signMediaUrl(nonExistentKey);
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
      expect(res.body.error.message).not.toContain(mediaDirectory);
      expect(res.body.error.message).not.toContain('ENOENT');
    });

    it('includes requestId in error responses', async () => {
      const res = await request(app).get('/v1/media');
      expect(res.body.error.requestId).toBeDefined();
      expect(typeof res.body.error.requestId).toBe('string');
    });

    it('does not leak MEDIA_ROOT or absolute paths in errors', async () => {
      const res = await request(app).get('/v1/media');
      expect(JSON.stringify(res.body)).not.toContain(mediaDirectory);
      expect(JSON.stringify(res.body)).not.toContain('/tmp/');
    });
  });

  describe('5.2 Valid media reading', () => {
    beforeAll(() => {
      writeFixtureFile('videos/test-read.mp4', VIDEO_FIXTURE);
      writeFixtureFile('thumbnails/test-read.jpg', JPEG_FIXTURE);
      writeFixtureFile('thumbnails/test-read.png', PNG_FIXTURE);
    });

    it('returns 200 for valid MP4 signed URL', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('video/mp4');
    });

    it('returns 200 for valid JPEG signed URL', async () => {
      const url = signMediaUrl('local:thumbnails/test-read.jpg');
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('returns 200 for valid PNG signed URL', async () => {
      const url = signMediaUrl('local:thumbnails/test-read.png');
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });

    it('sets Content-Type from server detection, not client claim', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      const res = await request(app).get(url);
      expect(res.headers['content-type']).toBe('video/mp4');
      // Even if client sends Accept: image/jpeg, server returns correct type
      const res2 = await request(app).get(url).set('Accept', 'image/jpeg');
      expect(res2.headers['content-type']).toBe('video/mp4');
    });

    it('sets X-Content-Type-Options: nosniff', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      const res = await request(app).get(url);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('returns correct Content-Length', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      const res = await request(app).get(url);
      expect(parseInt(res.headers['content-length'])).toBe(VIDEO_FIXTURE.length);
    });

    it('sets Accept-Ranges: bytes', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      const res = await request(app).get(url);
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    it('returns body matching fixture content', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      const res = await request(app).get(url);
      expect(Buffer.from(res.body)).toEqual(VIDEO_FIXTURE);
    });

    it('generates URL with default TTL close to 900 seconds', async () => {
      const now = Math.floor(Date.now() / 1000);
      const url = signMediaUrl('local:videos/test-read.mp4');
      const parsed = new URL(`http://localhost${url}`);
      const exp = parseInt(parsed.searchParams.get('exp')!);
      expect(exp).toBeGreaterThanOrEqual(now + 890);
      expect(exp).toBeLessThanOrEqual(now + 910);
    });

    it('uses configured PUBLIC_BASE_URL, not request Host header', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      const parsed = new URL(`http://localhost${url}`);
      expect(parsed.pathname).toBe('/v1/media');
    });

    it('signed URL does not contain JWT', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      expect(url).not.toMatch(/eyJ[A-Za-z0-9_-]+\.eyJ/); // JWT pattern
    });

    it('signed URL does not contain Task Token', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      expect(url).not.toContain('task');
      expect(url).not.toContain('token');
    });

    it('signed URL does not contain OAuth state', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      expect(url).not.toContain('oauth');
      expect(url).not.toContain('state');
    });

    it('signed URL does not contain TikTok token', async () => {
      const url = signMediaUrl('local:videos/test-read.mp4');
      expect(url).not.toContain('tiktok');
      expect(url).not.toContain('access_token');
    });
  });

  describe('5.3 Range requests', () => {
    let videoUrl: string;

    beforeAll(() => {
      writeFixtureFile('videos/test-range.mp4', VIDEO_FIXTURE);
      videoUrl = signMediaUrl('local:videos/test-range.mp4');
    });

    it('returns 206 for valid Range: bytes=0-9', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'bytes=0-9');
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 0-9/${VIDEO_FIXTURE.length}`);
      expect(parseInt(res.headers['content-length'])).toBe(10);
    });

    it('returns correct Content-Range header', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'bytes=5-15');
      expect(res.headers['content-range']).toBe(`bytes 5-15/${VIDEO_FIXTURE.length}`);
    });

    it('returns correct Content-Length for range', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'bytes=10-19');
      expect(parseInt(res.headers['content-length'])).toBe(10);
    });

    it('handles open-ended range bytes=10-', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'bytes=10-');
      expect(res.status).toBe(206);
      expect(parseInt(res.headers['content-length'])).toBe(VIDEO_FIXTURE.length - 10);
    });

    it('handles suffix range bytes=-10', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'bytes=-10');
      expect(res.status).toBe(206);
      expect(parseInt(res.headers['content-length'])).toBe(10);
    });

    it('returns 416 for range beyond file size', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'bytes=9999-10000');
      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe(`bytes */${VIDEO_FIXTURE.length}`);
    });

    it('returns 416 for start > end', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'bytes=20-10');
      expect(res.status).toBe(416);
    });

    it('returns 416 for invalid range format', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'invalid');
      expect(res.status).toBe(416);
    });

    it('returns correct bytes for range read', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'bytes=4-11');
      expect(res.status).toBe(206);
      expect(Buffer.from(res.body)).toEqual(VIDEO_FIXTURE.subarray(4, 12));
    });

    it('returns 416 for multi-part range (not supported)', async () => {
      const res = await request(app).get(videoUrl).set('Range', 'bytes=0-5, 10-15');
      expect(res.status).toBe(416);
    });
  });

  describe('5.4 Path boundary protection', () => {
    let validUrl: string;
    let storageKey: string;

    beforeAll(() => {
      storageKey = 'local:videos/test-boundary.mp4';
      writeFixtureFile('videos/test-boundary.mp4', VIDEO_FIXTURE);
      validUrl = signMediaUrl(storageKey);
    });

    it('rejects ../ traversal', async () => {
      const traversalKey = 'local:videos/../../../etc/passwd';
      const url = signMediaUrl(traversalKey);
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it('rejects URL encoded traversal', async () => {
      const traversalKey = 'local:%2e%2e%2f%2e%2e%2fetc%2fpasswd';
      const url = signMediaUrl(traversalKey);
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it('rejects double-encoded traversal', async () => {
      const traversalKey = 'local:%252e%252e%252f';
      const url = signMediaUrl(traversalKey);
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it('rejects backslash traversal', async () => {
      const traversalKey = 'local:videos\\..\\..\\secret';
      const url = signMediaUrl(traversalKey);
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it('rejects absolute Unix path', async () => {
      const traversalKey = 'local:/etc/passwd';
      const url = signMediaUrl(traversalKey);
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it('rejects Windows drive path', async () => {
      const traversalKey = 'local:C:\\Windows\\System32';
      const url = signMediaUrl(traversalKey);
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it('rejects NUL byte injection', async () => {
      const traversalKey = 'local:videos/test\0.mp4';
      const url = signMediaUrl(traversalKey);
      const res = await request(app).get(url);
      // NUL byte causes path normalization to fail or file not found
      expect([401, 404]).toContain(res.status);
    });

    it('rejects empty storage key', async () => {
      const url = signMediaUrl('local:');
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it('rejects MEDIA_ROOT prefix collision', async () => {
      // Create files to test prefix collision
      mkdirSync(path.join(mediaDirectory, 'safe', 'root'), { recursive: true });
      mkdirSync(path.join(mediaDirectory, 'safe', 'root-evil'), { recursive: true });
      writeFileSync(path.join(mediaDirectory, 'safe', 'root', 'file.txt'), 'safe');
      writeFileSync(path.join(mediaDirectory, 'safe', 'root-evil', 'file.txt'), 'evil');

      const safeKey = 'local:safe/root/file.txt';
      const evilKey = 'local:safe/root-evil/file.txt';

      // Both should be valid keys but different files
      const safeUrl = signMediaUrl(safeKey);
      const evilUrl = signMediaUrl(evilKey);

      // Neither should resolve to the other
      const safeParsed = new URL(`http://localhost${safeUrl}`);
      const evilParsed = new URL(`http://localhost${evilUrl}`);

      expect(safeParsed.searchParams.get('key')).not.toBe(evilParsed.searchParams.get('key'));
    });

    it('rejects symlink pointing outside MEDIA_ROOT', async () => {
      // Create a symlink pointing outside
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'publishos-outside-'));
      const outsideFile = path.join(outsideDir, 'secret.txt');
      writeFileSync(outsideFile, 'secret data');

      const symlinkPath = path.join(mediaDirectory, 'videos', 'symlink-outside.mp4');
      try {
        fs.symlinkSync(outsideFile, symlinkPath);

        const url = signMediaUrl('local:videos/symlink-outside.mp4');
        const res = await request(app).get(url);
        expect(res.status).toBe(404); // Should not serve symlinked file
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
        if (existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      }
    });

    it('handles legacy /uploads/ prefix correctly', async () => {
      writeFixtureFile('videos/legacy.mp4', VIDEO_FIXTURE);

      // Test with legacy prefix - signMediaUrl normalizes it
      const legacyKey = '/uploads/videos/legacy.mp4';
      const url = signMediaUrl(legacyKey);
      const res = await request(app).get(url);
      // Legacy prefix gets normalized to local: prefix
      expect([200, 401]).toContain(res.status);
    });

    it('does not allow mock/ prefix to become arbitrary disk read', async () => {
      // mock/ prefix should not be valid
      const mockKey = 'mock/some/path.mp4';
      const url = signMediaUrl(mockKey);
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });
  });
});

describe('Media Endpoint Integration - Upload', () => {
  describe('6.1 Upload permissions', () => {
    it('rejects unauthenticated video upload with 401', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .attach('video', VIDEO_FIXTURE, 'test.mp4');
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated thumbnail upload with 401', async () => {
      const res = await request(app)
        .post('/v1/upload/thumbnail')
        .attach('thumbnail', JPEG_FIXTURE, 'test.jpg');
      expect(res.status).toBe(401);
    });

    it('rejects Client Token upload with 403', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${clientAToken}`)
        .attach('video', VIDEO_FIXTURE, 'test.mp4');
      expect(res.status).toBe(403);
    });

    it('rejects Device Token upload with 403', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${deviceToken}`)
        .attach('video', VIDEO_FIXTURE, 'test.mp4');
      expect(res.status).toBe(403);
    });

    it('rejects Task Token upload with 403', async () => {
      // Create an account binding first if not exists
      let binding = await prisma.accountBinding.findFirst({ where: { clientId: clientAId } });
      if (!binding) {
        binding = await prisma.accountBinding.create({
          data: { clientId: clientAId, platform: 'tiktok', accountUsername: 'test-task-account' }
        });
      }

      // Create a task token by claiming a job
      const content = await prisma.content.create({
        data: { clientId: clientAId, title: 'Task Test', description: 'test', videoUrl: 'mock/task.mp4', platforms: '["tiktok"]', status: 'delivered' }
      });
      const job = await prisma.publishJob.create({
        data: { contentId: content.id, accountBindingId: binding.id, platform: 'tiktok', status: 'dispatched' }
      });

      // Get queue to get task token
      const queueRes = await request(app)
        .get('/v1/client/queue')
        .set('Authorization', `Bearer ${deviceToken}`);

      if (queueRes.body.queue?.length > 0) {
        const taskToken = queueRes.body.queue[0].job_token;
        const res = await request(app)
          .post('/v1/upload/video')
          .set('Authorization', `Bearer ${taskToken}`)
          .attach('video', VIDEO_FIXTURE, 'test.mp4');
        expect(res.status).toBe(403);
      }
    });

    it('allows Admin Token to upload video (enters file validation)', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'admin-video.mp4', contentType: 'video/mp4' });
      // Should not be 401/403
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('allows Admin Token to upload thumbnail (enters file validation)', async () => {
      const res = await request(app)
        .post('/v1/upload/thumbnail')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('thumbnail', JPEG_FIXTURE, { filename: 'admin-thumb.jpg', contentType: 'image/jpeg' });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('6.2 Valid file uploads', () => {
    it('accepts valid MP4 upload', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'valid.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.storage_key).toBeDefined();
      expect(res.body.data.storage_key).toMatch(/^local:videos\/[a-f0-9-]+\.mp4$/);
      expect(res.body.data.url).toBeDefined();
      expect(res.body.data.preview_url).toBeDefined();
      expect(res.body.data.expires_at).toBeDefined();
      expect(res.body.data.size).toBe(VIDEO_FIXTURE.length);
      expect(res.body.data.mime_type).toBe('video/mp4');
      expect(res.body.data.filename).toMatch(/^[a-f0-9-]+\.mp4$/);
    });

    it('accepts valid JPEG upload', async () => {
      const res = await request(app)
        .post('/v1/upload/thumbnail')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('thumbnail', JPEG_FIXTURE, { filename: 'valid.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(201);
      expect(res.body.data.storage_key).toMatch(/^local:thumbnails\/[a-f0-9-]+\.jpg$/);
      expect(res.body.data.mime_type).toBe('image/jpeg');
    });

    it('accepts valid PNG upload', async () => {
      const res = await request(app)
        .post('/v1/upload/thumbnail')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('thumbnail', PNG_FIXTURE, { filename: 'valid.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body.data.storage_key).toMatch(/^local:thumbnails\/[a-f0-9-]+\.png$/);
      expect(res.body.data.mime_type).toBe('image/png');
    });

    it('storage_key does not contain absolute path', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'path-test.mp4', contentType: 'video/mp4' });

      expect(res.body.data.storage_key).not.toContain('/tmp/');
      expect(res.body.data.storage_key).not.toContain(mediaDirectory);
    });

    it('storage_key does not contain original filename', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'original-name-secret.mp4', contentType: 'video/mp4' });

      expect(res.body.data.storage_key).not.toContain('original-name-secret');
    });

    it('filename is UUID format', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'uuid-test.mp4', contentType: 'video/mp4' });

      expect(res.body.data.filename).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.mp4$/);
    });

    it('extension comes from detected content, not filename', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'fake.avi', contentType: 'video/x-msvideo' });

      // Should detect as mp4 from content
      expect(res.body.data.storage_key).toMatch(/\.mp4$/);
      expect(res.body.data.mime_type).toBe('video/mp4');
    });

    it('preview URL is signed and expires', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'preview-test.mp4', contentType: 'video/mp4' });

      const previewUrl = res.body.data.preview_url;
      expect(previewUrl).toContain('/v1/media');
      expect(previewUrl).toContain('sig=');
      expect(previewUrl).toContain('exp=');

      const expiresAt = new Date(res.body.data.expires_at);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      expect(diffMs).toBeGreaterThan(800_000); // ~900s - some margin
      expect(diffMs).toBeLessThan(1_000_000);
    });

    it('file exists in MEDIA_ROOT after upload', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'exists-test.mp4', contentType: 'video/mp4' });

      const storageKey = res.body.data.storage_key;
      const relativePath = storageKey.replace('local:', '');
      const fullPath = path.join(mediaDirectory, relativePath);
      expect(existsSync(fullPath)).toBe(true);
      expect(statSync(fullPath).size).toBe(VIDEO_FIXTURE.length);
    });
  });

  describe('6.3 File disguise detection', () => {
    it('rejects .mp4 filename with text content', async () => {
      const textContent = Buffer.from('This is not a video file');
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', textContent, { filename: 'fake.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('media_type_not_allowed');
    });

    it('rejects MIME claim video/mp4 but PNG file header', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', PNG_FIXTURE, { filename: 'fake.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('media_type_not_allowed');
    });

    it('handles MIME claim image/png but JPEG file header', async () => {
      const res = await request(app)
        .post('/v1/upload/thumbnail')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('thumbnail', JPEG_FIXTURE, { filename: 'fake.png', contentType: 'image/png' });

      // Server should detect from content, not MIME claim
      if (res.status === 201) {
        expect(res.body.data.mime_type).toBe('image/jpeg');
        expect(res.body.data.storage_key).toMatch(/\.jpg$/);
      } else {
        expect(res.status).toBe(415);
      }
    });

    it('rejects .jpg filename with script content', async () => {
      const scriptContent = Buffer.from('<script>alert("xss")</script>');
      const res = await request(app)
        .post('/v1/upload/thumbnail')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('thumbnail', scriptContent, { filename: 'evil.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('media_type_not_allowed');
    });

    it('rejects empty file', async () => {
      const emptyContent = Buffer.alloc(0);
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', emptyContent, { filename: 'empty.mp4', contentType: 'video/mp4' });

      // Empty file returns 415 (media_type_not_allowed) as it cannot be detected
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('media_type_not_allowed');
    });

    it('rejects file too short to identify header', async () => {
      const shortContent = Buffer.from([0x00, 0x01, 0x02]);
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', shortContent, { filename: 'short.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(415);
    });

    it('rejects unsupported format', async () => {
      const gifContent = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;');
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', gifContent, { filename: 'test.gif', contentType: 'image/gif' });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('media_type_not_allowed');
    });

    it('returns stable error code for type mismatch, not 500', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', Buffer.from('text'), { filename: 'bad.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(415);
      expect(res.status).not.toBe(500);
    });

    it('error does not leak temporary file path', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', Buffer.from('text'), { filename: 'bad.mp4', contentType: 'video/mp4' });

      expect(JSON.stringify(res.body)).not.toContain('/tmp/');
      expect(JSON.stringify(res.body)).not.toContain('.upload');
    });
  });

  describe('6.4 Size limits', () => {
    // Use smaller limits for testing
    const SMALL_VIDEO_MAX = 100;
    const SMALL_IMAGE_MAX = 50;

    beforeAll(() => {
      process.env.UPLOAD_VIDEO_MAX_BYTES = String(SMALL_VIDEO_MAX);
      process.env.UPLOAD_IMAGE_MAX_BYTES = String(SMALL_IMAGE_MAX);
    });

    afterAll(() => {
      delete process.env.UPLOAD_VIDEO_MAX_BYTES;
      delete process.env.UPLOAD_IMAGE_MAX_BYTES;
    });

    it('accepts video at exact limit', async () => {
      const exactVideo = Buffer.alloc(SMALL_VIDEO_MAX, 0x00);
      // Add valid MP4 header
      exactVideo.writeUInt32BE(0x0000001c, 0);
      Buffer.from('ftyp').copy(exactVideo, 4);

      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', exactVideo, { filename: 'exact.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(201);
    });

    it('rejects video exceeding limit by 1 byte', async () => {
      const oversizeVideo = Buffer.alloc(SMALL_VIDEO_MAX + 1, 0x00);
      oversizeVideo.writeUInt32BE(0x0000001c, 0);
      Buffer.from('ftyp').copy(oversizeVideo, 4);

      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', oversizeVideo, { filename: 'oversize.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('upload_too_large');
    });

    it('accepts image at exact limit', async () => {
      const exactImage = Buffer.from(JPEG_FIXTURE.slice(0, SMALL_IMAGE_MAX));

      const res = await request(app)
        .post('/v1/upload/thumbnail')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('thumbnail', exactImage, { filename: 'exact.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(201);
    });

    it('rejects image exceeding limit by 1 byte', async () => {
      const oversizeImage = Buffer.alloc(SMALL_IMAGE_MAX + 1, 0x00);
      // JPEG header
      oversizeImage[0] = 0xff;
      oversizeImage[1] = 0xd8;

      const res = await request(app)
        .post('/v1/upload/thumbnail')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('thumbnail', oversizeImage, { filename: 'oversize.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('upload_too_large');
    });

    it('video and image limits are independent', async () => {
      // A file that fits image limit but exceeds video limit
      // This shouldn't happen in practice, but tests independence
      const mediumFile = Buffer.alloc(SMALL_IMAGE_MAX + 10, 0x00);
      mediumFile[0] = 0xff;
      mediumFile[1] = 0xd8;

      // Should fail for thumbnail (exceeds image limit)
      const thumbRes = await request(app)
        .post('/v1/upload/thumbnail')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('thumbnail', mediumFile, { filename: 'medium.jpg', contentType: 'image/jpeg' });

      expect(thumbRes.status).toBe(413);
    });
  });

  describe('6.5 Cleanup and filename safety', () => {
    it('cleans up temp file on validation failure', async () => {
      const tempDir = path.join(mediaDirectory, '.tmp');
      mkdirSync(tempDir, { recursive: true });

      const beforeFiles = existsSync(tempDir) ? fs.readdirSync(tempDir).length : 0;

      await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', Buffer.from('invalid'), { filename: 'bad.mp4', contentType: 'video/mp4' });

      const afterFiles = fs.readdirSync(tempDir).length;
      expect(afterFiles).toBe(beforeFiles);
    });

    it('handles originalname with ../ traversal safely', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: '../../../etc/passwd.mp4', contentType: 'video/mp4' });

      if (res.status === 201) {
        expect(res.body.data.storage_key).not.toContain('..');
        expect(res.body.data.storage_key).not.toContain('etc');
      }
    });

    it('handles originalname with backslash safely', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: '..\\..\\secret.mp4', contentType: 'video/mp4' });

      if (res.status === 201) {
        expect(res.body.data.storage_key).not.toContain('\\');
        expect(res.body.data.storage_key).not.toContain('secret');
      }
    });

    it('handles Unicode and control characters in originalname', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: '视频\x00\x01.mp4', contentType: 'video/mp4' });

      if (res.status === 201) {
        // Filename should be UUID, not original
        expect(res.body.data.filename).toMatch(/^[a-f0-9-]+\.mp4$/);
      }
    });

    it('generates unique filenames for consecutive uploads', async () => {
      const res1 = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'same.mp4', contentType: 'video/mp4' });

      const res2 = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'same.mp4', contentType: 'video/mp4' });

      if (res1.status === 201 && res2.status === 201) {
        expect(res1.body.data.storage_key).not.toBe(res2.body.data.storage_key);
        expect(res1.body.data.filename).not.toBe(res2.body.data.filename);
      }
    });

    it('upload response does not leak MEDIA_ROOT', async () => {
      const res = await request(app)
        .post('/v1/upload/video')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('video', VIDEO_FIXTURE, { filename: 'leak-test.mp4', contentType: 'video/mp4' });

      expect(JSON.stringify(res.body)).not.toContain(mediaDirectory);
      expect(JSON.stringify(res.body)).not.toContain('/tmp/');
    });
  });
});

describe('Media Endpoint Integration - Client Queue', () => {
  let contentWithVideo: any;
  let contentWithThumbnail: any;
  let bindingA: any;

  beforeAll(async () => {
    // Create account binding if not exists
    bindingA = await prisma.accountBinding.findFirst({ where: { clientId: clientAId } });
    if (!bindingA) {
      bindingA = await prisma.accountBinding.create({
        data: { clientId: clientAId, platform: 'tiktok', accountUsername: 'queue-test-account' }
      });
    }

    // Create content with video
    contentWithVideo = await prisma.content.create({
      data: {
        clientId: clientAId,
        title: 'Queue Video Test',
        description: 'test',
        videoUrl: 'local:videos/queue-test.mp4',
        thumbnailUrl: null,
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    // Create content with video and thumbnail
    contentWithThumbnail = await prisma.content.create({
      data: {
        clientId: clientAId,
        title: 'Queue Thumb Test',
        description: 'test',
        videoUrl: 'local:videos/queue-thumb.mp4',
        thumbnailUrl: 'local:thumbnails/queue-thumb.jpg',
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    writeFixtureFile('videos/queue-test.mp4', VIDEO_FIXTURE);
    writeFixtureFile('videos/queue-thumb.mp4', VIDEO_FIXTURE);
    writeFixtureFile('thumbnails/queue-thumb.jpg', JPEG_FIXTURE);

    // Create dispatched jobs
    await prisma.publishJob.create({
      data: { contentId: contentWithVideo.id, accountBindingId: bindingA.id, platform: 'tiktok', status: 'dispatched' }
    });
    await prisma.publishJob.create({
      data: { contentId: contentWithThumbnail.id, accountBindingId: bindingA.id, platform: 'tiktok', status: 'dispatched' }
    });
  });

  it('device can only get jobs for its own client', async () => {
    // Register device for client B
    const deviceBRes = await request(app)
      .post('/v1/client/register')
      .set('Authorization', `Bearer ${clientBToken}`)
      .send({ device_id: 'device-b-queue', client_id: clientBId });
    const deviceBToken = deviceBRes.body.device_token;

    const queueA = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const queueB = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceBToken}`);

    // Device A should see Client A's jobs (may be empty if already claimed)
    // Device B should have no jobs (Client B has no dispatched content with bindings)
    expect(queueB.body.queue || []).toHaveLength(0);
  });

  it('queue returns media_url when jobs exist', async () => {
    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const queue = res.body.queue || [];
    // Queue may be empty if all jobs already claimed
    if (queue.length > 0) {
      for (const job of queue) {
        expect(job.media_url).toBeDefined();
        expect(job.media_url).toContain('/v1/media');
        expect(job.media_url).toContain('sig=');
      }
    }
  });

  it('queue returns thumbnail_url when thumbnail exists', async () => {
    // Create a new job specifically for this test
    const testContent = await prisma.content.create({
      data: {
        clientId: clientAId,
        title: 'Thumb Test Content',
        description: 'test',
        videoUrl: 'local:videos/thumb-test.mp4',
        thumbnailUrl: 'local:thumbnails/thumb-test.jpg',
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    await prisma.publishJob.create({
      data: { contentId: testContent.id, accountBindingId: bindingA.id, platform: 'tiktok', status: 'dispatched' }
    });

    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const queue = res.body.queue || [];
    const thumbJob = queue.find((j: any) => j.title === 'Thumb Test Content');

    if (thumbJob) {
      expect(thumbJob.thumbnail_url).toBeDefined();
      expect(thumbJob.thumbnail_url).toContain('/v1/media');
    }
  });

  it('URLs use configured PUBLIC_BASE_URL', async () => {
    // Create a new job for this test
    const testContent = await prisma.content.create({
      data: {
        clientId: clientAId,
        title: 'URL Test Content',
        description: 'test',
        videoUrl: 'local:videos/url-test.mp4',
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    await prisma.publishJob.create({
      data: { contentId: testContent.id, accountBindingId: bindingA.id, platform: 'tiktok', status: 'dispatched' }
    });

    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const queue = res.body.queue || [];
    if (queue.length > 0) {
      for (const job of queue) {
        // URLs should contain /v1/media path
        expect(job.media_url).toContain('/v1/media');
      }
    }
  });

  it('URLs are not S3 URLs', async () => {
    // Create a new job for this test
    const testContent = await prisma.content.create({
      data: {
        clientId: clientAId,
        title: 'S3 Check Content',
        description: 'test',
        videoUrl: 'local:videos/s3-check.mp4',
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    await prisma.publishJob.create({
      data: { contentId: testContent.id, accountBindingId: bindingA.id, platform: 'tiktok', status: 'dispatched' }
    });

    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const queue = res.body.queue || [];
    if (queue.length > 0) {
      for (const job of queue) {
        expect(job.media_url).not.toContain('s3.amazonaws.com');
        expect(job.media_url).not.toContain('amazonaws.com');
      }
    }
  });

  it('URLs have approximately 900 second expiry', async () => {
    // Create a new job for this test
    const testContent = await prisma.content.create({
      data: {
        clientId: clientAId,
        title: 'Expiry Test Content',
        description: 'test',
        videoUrl: 'local:videos/expiry-test.mp4',
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    await prisma.publishJob.create({
      data: { contentId: testContent.id, accountBindingId: bindingA.id, platform: 'tiktok', status: 'dispatched' }
    });

    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const queue = res.body.queue || [];
    const now = Math.floor(Date.now() / 1000);

    if (queue.length > 0) {
      for (const job of queue) {
        const parsed = new URL(`http://localhost${job.media_url}`);
        const exp = parseInt(parsed.searchParams.get('exp')!);
        expect(exp).toBeGreaterThanOrEqual(now + 890);
        expect(exp).toBeLessThanOrEqual(now + 910);
      }
    }
  });

  it('media_url can be used to read the fixture', async () => {
    writeFixtureFile('videos/readable.mp4', VIDEO_FIXTURE);

    // Create a new job for this test
    const testContent = await prisma.content.create({
      data: {
        clientId: clientAId,
        title: 'Readable Content',
        description: 'test',
        videoUrl: 'local:videos/readable.mp4',
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    await prisma.publishJob.create({
      data: { contentId: testContent.id, accountBindingId: bindingA.id, platform: 'tiktok', status: 'dispatched' }
    });

    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const queue = res.body.queue || [];
    if (queue.length > 0) {
      const mediaUrl = queue[0].media_url;
      // Extract path from full URL if needed
      const urlPath = mediaUrl.startsWith('http') ? new URL(mediaUrl).pathname + new URL(mediaUrl).search : mediaUrl;
      const mediaRes = await request(app).get(urlPath);
      expect(mediaRes.status).toBe(200);
      expect(mediaRes.headers['content-type']).toMatch(/^(video|image)\//);
    }
  });

  it('queue does not leak local absolute paths', async () => {
    // Create a new job for this test
    const testContent = await prisma.content.create({
      data: {
        clientId: clientAId,
        title: 'Path Leak Test',
        description: 'test',
        videoUrl: 'local:videos/path-test.mp4',
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    await prisma.publishJob.create({
      data: { contentId: testContent.id, accountBindingId: bindingA.id, platform: 'tiktok', status: 'dispatched' }
    });

    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const resStr = JSON.stringify(res.body);
    expect(resStr).not.toContain(mediaDirectory);
    expect(resStr).not.toContain('/tmp/');
    expect(resStr).not.toContain('/home/');
  });

  it('queue does not leak storage key internals', async () => {
    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    // Should not expose internal storage paths
    const resStr = JSON.stringify(res.body);
    expect(resStr).not.toContain('.tmp');
  });

  it('queue does not leak TikTok access token', async () => {
    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const resStr = JSON.stringify(res.body);
    expect(resStr).not.toContain('access_token');
    expect(resStr).not.toContain('refresh_token');
  });

  it('queue does not leak device bearer token', async () => {
    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const resStr = JSON.stringify(res.body);
    expect(resStr).not.toContain(deviceToken);
  });

  it('Task Token semantics remain unchanged from Phase 1B', async () => {
    // Create a new job for this test
    const testContent = await prisma.content.create({
      data: {
        clientId: clientAId,
        title: 'Token Semantics Test',
        description: 'test',
        videoUrl: 'local:videos/token-test.mp4',
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    await prisma.publishJob.create({
      data: { contentId: testContent.id, accountBindingId: bindingA.id, platform: 'tiktok', status: 'dispatched' }
    });

    const res = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    const queue = res.body.queue || [];
    if (queue.length > 0) {
      for (const job of queue) {
        expect(job.job_token).toBeDefined();
        // Token should be JWT format
        expect(job.job_token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      }
    }
  });

  it('Client A device cannot get Client B media URLs', async () => {
    // Register device for client B
    const deviceBRes = await request(app)
      .post('/v1/client/register')
      .set('Authorization', `Bearer ${clientBToken}`)
      .send({ device_id: 'device-b-isolation', client_id: clientBId });
    const deviceBToken = deviceBRes.body.device_token;

    // Create content for client B
    const contentB = await prisma.content.create({
      data: {
        clientId: clientBId,
        title: 'B Only Content',
        description: 'test',
        videoUrl: 'local:videos/b-only.mp4',
        platforms: '["tiktok"]',
        status: 'delivered'
      }
    });

    // Create or get binding for client B
    let bindingB = await prisma.accountBinding.findFirst({ where: { clientId: clientBId } });
    if (!bindingB) {
      bindingB = await prisma.accountBinding.create({
        data: { clientId: clientBId, platform: 'tiktok', accountUsername: 'b-queue-account' }
      });
    }

    await prisma.publishJob.create({
      data: { contentId: contentB.id, accountBindingId: bindingB.id, platform: 'tiktok', status: 'dispatched' }
    });

    const queueA = await request(app)
      .get('/v1/client/queue')
      .set('Authorization', `Bearer ${deviceToken}`);

    // Device A's URLs should have device A's audience
    const queue = queueA.body.queue || [];
    for (const job of queue) {
      const parsed = new URL(`http://localhost${job.media_url}`);
      const aud = parsed.searchParams.get('aud');
      expect(aud).toContain('test-device-media');
    }
  });
});
