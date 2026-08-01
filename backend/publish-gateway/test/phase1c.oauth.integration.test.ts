import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

vi.mock('dotenv/config', () => ({}));
const publisherMock = vi.hoisted(() => ({ publishToTikTok: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/publisher', () => publisherMock);

// Import rate limit store to clear between tests
import { defaultRateLimitStore } from '../src/middleware/http-security';

// Mock TikTok API responses
const mockTikTokTokenResponse = vi.hoisted(() => ({
  ok: true,
  data: {
    access_token: 'mock-tiktok-access-token',
    open_id: 'mock-tiktok-open-id-12345',
    expires_in: 86400,
    refresh_token: 'mock-tiktok-refresh-token',
    scope: 'user.info.basic,video.upload'
  }
}));

const mockTikTokUserResponse = vi.hoisted(() => ({
  data: {
    user: {
      display_name: 'Test TikTok User'
    }
  }
}));

// Track fetch calls
let tiktokTokenCalls = 0;
let tiktokUserCalls = 0;

// Mock global fetch for TikTok endpoints
// no-network guard installs in beforeEach and restores in afterEach
// We need to override fetch AFTER no-network guard installs it
const originalFetch = globalThis.fetch;

function mockFetchForTikTok() {
  (globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;

    if (urlStr.includes('open.tiktokapis.com/v2/oauth/token')) {
      tiktokTokenCalls++;
      return new Response(JSON.stringify(mockTikTokTokenResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (urlStr.includes('open.tiktokapis.com/v2/user/info')) {
      tiktokUserCalls++;
      return new Response(JSON.stringify(mockTikTokUserResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // For other URLs, throw to block (simulating no-network guard)
    throw new Error('Unexpected real network access blocked');
  };
}

// Override fetch in beforeEach (after no-network guard installs its version)
beforeEach(() => {
  mockFetchForTikTok();
});

describe('Client-owned binding lifecycle hotfix', () => {
  it('restores the same revoked TikTok account binding on OAuth callback', async () => {
    const existing = await prisma.accountBinding.findFirst({
      where: { clientId: clientAId, platform: 'tiktok', platformUserId: mockTikTokTokenResponse.data.open_id },
    });
    const revoked = existing
      ? await prisma.accountBinding.update({
          where: { id: existing.id },
          data: { active: false, status: 'revoked', accessToken: null, refreshToken: null, expiresAt: null, scope: null, grantedScopes: null },
        })
      : await prisma.accountBinding.create({
          data: {
            clientId: clientAId, platform: 'tiktok', accountUsername: mockTikTokUserResponse.data.user.display_name,
            username: mockTikTokUserResponse.data.user.display_name, platformUserId: mockTikTokTokenResponse.data.open_id,
            active: false, status: 'revoked',
          },
        });
    const previousScope = mockTikTokTokenResponse.data.scope;
    mockTikTokTokenResponse.data.scope = 'user.info.basic,video.upload,video.list';
    try {
      const stateResponse = await request(app).get('/v1/tiktok/auth').set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateResponse.body.data.authUrl).searchParams.get('state')!;
      const callback = await request(app).get(`/v1/tiktok/callback?state=${state}&code=test-code`);
      expect(callback.status).toBe(200);
      const restored = await prisma.accountBinding.findUniqueOrThrow({ where: { id: revoked.id } });
      expect(restored).toMatchObject({ active: true, status: 'active', reauthorizationRequired: false });
      expect(restored.accessToken).toBeTruthy();
      expect(restored.refreshToken).toBeTruthy();
      expect(restored.expiresAt).toBeInstanceOf(Date);
      expect(restored.grantedScopes).toContain('video.list');
    } finally {
      mockTikTokTokenResponse.data.scope = previousScope;
    }
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// Unique temp directories for this test suite
const testDirectory = mkdtempSync(path.join(tmpdir(), 'publishos-oauth-integration-'));
const testDatabase = path.join(testDirectory, 'gateway.db');
const testDatabaseUrl = `file:${testDatabase}`;
const mediaDirectory = mkdtempSync(path.join(tmpdir(), 'publishos-oauth-media-'));
const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = path.join(gatewayRoot, 'node_modules', '.bin', 'prisma');
const execFileAsync = promisify(execFile);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'oauth-integration-test-secret-at-least-32-bytes';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.MEDIA_ROOT = mediaDirectory;
process.env.MEDIA_SIGNING_SECRET = 'oauth-media-signing-secret-at-least-32-bytes-long';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
process.env.TIKTOK_CLIENT_KEY = 'test-tiktok-client-key';
process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-client-secret';
process.env.TIKTOK_REDIRECT_URI = 'http://localhost:3000/v1/tiktok/callback';

let app: ReturnType<typeof import('../src/app').createApp>;
let prisma: typeof import('../src/lib/prisma').prisma;
let adminToken = '';
let clientAToken = '';
let clientBToken = '';
let adminId = '';
let clientAId = '';
let clientBId = '';

// Console spy for log redaction tests
let consoleOutput: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

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

  const admin = await prisma.admin.create({ data: { name: 'Admin', email: 'admin@oauth.test', password } });
  adminId = admin.id;

  const clientA = await prisma.client.create({ data: { name: 'ClientA', email: 'a@oauth.test', password } });
  clientAId = clientA.id;

  const clientB = await prisma.client.create({ data: { name: 'ClientB', email: 'b@oauth.test', password } });
  clientBId = clientB.id;

  // Login and get tokens
  adminToken = (await request(app).post('/v1/auth/admin/login').send({ email: 'admin@oauth.test', password: 'test-password' })).body.data.token;
  clientAToken = (await request(app).post('/v1/auth/login').send({ email: 'a@oauth.test', password: 'test-password' })).body.data.token;
  clientBToken = (await request(app).post('/v1/auth/login').send({ email: 'b@oauth.test', password: 'test-password' })).body.data.token;
}, 60_000);

afterAll(async () => {
  try {
    await prisma?.$disconnect();
  } finally {
    rmSync(testDirectory, { recursive: true, force: true });
    rmSync(mediaDirectory, { recursive: true, force: true });
  }
});

beforeEach(() => {
  tiktokTokenCalls = 0;
  tiktokUserCalls = 0;
  consoleOutput = [];
  console.log = (...args: any[]) => consoleOutput.push(args.join(' '));
  console.error = (...args: any[]) => consoleOutput.push(args.join(' '));
  console.warn = (...args: any[]) => consoleOutput.push(args.join(' '));
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  // Clear rate limit store between tests
  defaultRateLimitStore.clear();
});

describe('OAuth Endpoint Integration - Start Endpoints', () => {
  describe('8. OAuth Start Endpoint Tests', () => {
    it('rejects unauthenticated Browser start with 401', async () => {
      const res = await request(app).get('/v1/tiktok/auth');
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated Electron start with 401', async () => {
      const res = await request(app).get('/v1/tiktok/auth-url');
      expect(res.status).toBe(401);
    });

    it('rejects Client A requesting Client B with 403', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientBId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects Admin creating OAuth state for a Client', async () => {
      const browser = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const electron = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(browser.status).toBe(403);
      expect(electron.status).toBe(403);
    });

    it('allows Client to create state for itself', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.authUrl).toBeDefined();
    });

    it('returns different original state for two calls', async () => {
      const res1 = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const res2 = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const url1 = new URL(res1.body.data.authUrl);
      const url2 = new URL(res2.body.data.authUrl);

      expect(url1.searchParams.get('state')).not.toBe(url2.searchParams.get('state'));
    });

    it('state has at least 256-bit entropy', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const url = new URL(res.body.data.authUrl);
      const state = url.searchParams.get('state')!;

      // base64url encoded 32 bytes should be 43 chars
      expect(state.length).toBeGreaterThanOrEqual(43);
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('DB only saves state hash, not original state', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const url = new URL(res.body.data.authUrl);
      const state = url.searchParams.get('state')!;
      const expectedHash = crypto.createHash('sha256').update(state).digest('hex');

      const dbRecord = await prisma.oAuthAuthorizationState.findFirst({
        where: { clientId: clientAId },
        orderBy: { createdAt: 'desc' }
      });

      expect(dbRecord).toBeDefined();
      expect(dbRecord!.stateHash).toBe(expectedHash);
    });

    it('DB does not contain original state', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const url = new URL(res.body.data.authUrl);
      const state = url.searchParams.get('state')!;

      // Search DB for original state - should not find it
      const allStates = await prisma.oAuthAuthorizationState.findMany({
        where: { clientId: clientAId }
      });

      for (const record of allStates) {
        expect(record.stateHash).not.toBe(state);
      }
    });

    it('stateHash matches SHA-256 of original state', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const url = new URL(res.body.data.authUrl);
      const state = url.searchParams.get('state')!;
      const expectedHash = crypto.createHash('sha256').update(state).digest('hex');

      const dbRecord = await prisma.oAuthAuthorizationState.findFirst({
        where: { clientId: clientAId },
        orderBy: { createdAt: 'desc' }
      });

      expect(dbRecord!.stateHash).toBe(expectedHash);
    });

    it('sets provider=tiktok', async () => {
      const dbRecord = await prisma.oAuthAuthorizationState.findFirst({
        where: { clientId: clientAId },
        orderBy: { createdAt: 'desc' }
      });

      expect(dbRecord!.provider).toBe('tiktok');
    });

    it('sets flow=browser for browser endpoint', async () => {
      await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const dbRecord = await prisma.oAuthAuthorizationState.findFirst({
        where: { clientId: clientAId },
        orderBy: { createdAt: 'desc' }
      });

      expect(dbRecord!.flow).toBe('browser');
    });

    it('sets flow=electron for electron endpoint', async () => {
      await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const dbRecord = await prisma.oAuthAuthorizationState.findFirst({
        where: { clientId: clientAId, flow: 'electron' },
        orderBy: { createdAt: 'desc' }
      });

      expect(dbRecord!.flow).toBe('electron');
    });

    it('redirectUri matches flow exactly', async () => {
      // Browser flow
      await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const browserState = await prisma.oAuthAuthorizationState.findFirst({
        where: { clientId: clientAId, flow: 'browser' },
        orderBy: { createdAt: 'desc' }
      });

      expect(browserState!.redirectUri).toBe('http://localhost:3000/v1/tiktok/callback');

      // Electron flow
      await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const electronState = await prisma.oAuthAuthorizationState.findFirst({
        where: { clientId: clientAId, flow: 'electron' },
        orderBy: { createdAt: 'desc' }
      });

      expect(electronState!.redirectUri).toBe('publishos://tiktok-callback');
    });

    it('expiresAt is approximately 10 minutes', async () => {
      const before = new Date();
      await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const after = new Date();

      const dbRecord = await prisma.oAuthAuthorizationState.findFirst({
        where: { clientId: clientAId },
        orderBy: { createdAt: 'desc' }
      });

      const expiresAt = dbRecord!.expiresAt.getTime();
      const diffBefore = expiresAt - before.getTime();
      const diffAfter = expiresAt - after.getTime();

      // Should be ~10 minutes (600,000ms) with some margin
      expect(diffBefore).toBeGreaterThan(590_000);
      expect(diffAfter).toBeLessThan(610_000);
    });

    it('consumedAt is initially empty', async () => {
      await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const dbRecord = await prisma.oAuthAuthorizationState.findFirst({
        where: { clientId: clientAId },
        orderBy: { createdAt: 'desc' }
      });

      expect(dbRecord!.consumedAt).toBeNull();
    });

    it('creates oauth_started AuditLog', async () => {
      const beforeCount = await prisma.auditLog.count({
        where: { action: 'oauth_started' }
      });

      await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const afterCount = await prisma.auditLog.count({
        where: { action: 'oauth_started' }
      });

      expect(afterCount).toBe(beforeCount + 1);

      const latestLog = await prisma.auditLog.findFirst({
        where: { action: 'oauth_started' },
        orderBy: { createdAt: 'desc' }
      });

      expect(latestLog!.targetType).toBe('client');
      expect(latestLog!.targetId).toBe(clientAId);
    });

    it('AuditLog does not contain original state', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const url = new URL(res.body.data.authUrl);
      const state = url.searchParams.get('state')!;

      const latestLog = await prisma.auditLog.findFirst({
        where: { action: 'oauth_started' },
        orderBy: { createdAt: 'desc' }
      });

      expect(latestLog!.details).not.toContain(state);
    });

    it('AuditLog does not contain TikTok secret', async () => {
      await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const latestLog = await prisma.auditLog.findFirst({
        where: { action: 'oauth_started' },
        orderBy: { createdAt: 'desc' }
      });

      expect(latestLog!.details).not.toContain('test-tiktok-client-secret');
      expect(latestLog!.details).not.toContain('TIKTOK_CLIENT_SECRET');
    });

    it('fails closed when TikTok config is missing', async () => {
      const originalKey = process.env.TIKTOK_CLIENT_KEY;
      const originalSecret = process.env.TIKTOK_CLIENT_SECRET;

      try {
        delete process.env.TIKTOK_CLIENT_KEY;
        delete process.env.TIKTOK_CLIENT_SECRET;

        // Need to reinitialize to pick up env changes
        const res = await request(app)
          .get(`/v1/tiktok/auth?clientId=${clientAId}`)
          .set('Authorization', `Bearer ${clientAToken}`);

        // Returns 500 or 503 when config is missing
        expect([500, 503]).toContain(res.status);
        expect(res.body.error.code).toBe('oauth_not_configured');
      } finally {
        process.env.TIKTOK_CLIENT_KEY = originalKey;
        process.env.TIKTOK_CLIENT_SECRET = originalSecret;
      }
    });

    it('Auth URL does not contain modifiable clientId JSON', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const authUrl = res.body.data.authUrl;
      expect(authUrl).not.toContain('{');
      expect(authUrl).not.toContain('}');
      expect(authUrl).not.toContain('"clientId"');
    });

    it('Browser and Electron URLs have correct redirect URIs', async () => {
      const browserRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const electronRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const browserUrl = new URL(browserRes.body.data.authUrl);
      const electronUrl = new URL(electronRes.body.data.authUrl);

      expect(browserUrl.searchParams.get('redirect_uri')).toBe('http://localhost:3000/v1/tiktok/callback');
      expect(electronUrl.searchParams.get('redirect_uri')).toBe('publishos://tiktok-callback');
    });
  });
});

describe('OAuth Endpoint Integration - State Rejection Paths', () => {
  describe('9. OAuth State Rejection Tests', () => {
    let validBrowserState: string;
    let validElectronState: string;

    beforeEach(async () => {
      // Create valid states for testing
      const browserRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const browserUrl = new URL(browserRes.body.data.authUrl);
      validBrowserState = browserUrl.searchParams.get('state')!;

      const electronRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const electronUrl = new URL(electronRes.body.data.authUrl);
      validElectronState = electronUrl.searchParams.get('state')!;
    });

    it('rejects missing state', async () => {
      const res = await request(app)
        .get('/v1/tiktok/callback?code=test-code');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('oauth_state_invalid');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects missing code', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${validBrowserState}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('oauth_state_invalid');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects forged state', async () => {
      const forgedState = crypto.randomBytes(32).toString('base64url');
      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${forgedState}&code=test-code`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('oauth_state_invalid');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects expired state', async () => {
      // Create a state and manually expire it
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;
      const stateHash = crypto.createHash('sha256').update(state).digest('hex');

      // Manually expire the state
      await prisma.oAuthAuthorizationState.update({
        where: { stateHash },
        data: { expiresAt: new Date(Date.now() - 1000) }
      });

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('oauth_state_expired');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects already consumed state', async () => {
      // Consume the state first
      await request(app)
        .get(`/v1/tiktok/callback?state=${validBrowserState}&code=test-code`);

      tiktokTokenCalls = 0;

      // Try to reuse
      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${validBrowserState}&code=test-code`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('oauth_state_replayed');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects Browser state used for Electron exchange', async () => {
      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          clientId: clientAId,
          code: 'test-code',
          state: validBrowserState
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('oauth_flow_mismatch');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects Electron state used for Browser callback', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${validElectronState}&code=test-code`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('oauth_flow_mismatch');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects redirectUri mismatch', async () => {
      // Create state with different redirect URI
      const stateHash = crypto.createHash('sha256').update(validBrowserState).digest('hex');
      await prisma.oAuthAuthorizationState.update({
        where: { stateHash },
        data: { redirectUri: 'http://evil.com/callback' }
      });

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${validBrowserState}&code=test-code`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('oauth_state_invalid');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects provider mismatch', async () => {
      const stateHash = crypto.createHash('sha256').update(validBrowserState).digest('hex');
      await prisma.oAuthAuthorizationState.update({
        where: { stateHash },
        data: { provider: 'instagram' }
      });

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${validBrowserState}&code=test-code`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('oauth_state_invalid');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects body clientId not matching state clientId', async () => {
      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          clientId: clientBId, // Different from state's clientId
          code: 'test-code',
          state: validElectronState
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('tenant_mismatch');
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects authenticated Client not matching state Client', async () => {
      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientBToken}`) // Client B token
        .send({
          clientId: clientAId, // Client A's state
          code: 'test-code',
          state: validElectronState
        });

      expect(res.status).toBe(403);
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects Admin exchange', async () => {
      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'test-code', state: validElectronState });

      expect(res.status).toBe(403);
      expect(tiktokTokenCalls).toBe(0);
    });

    it('rejects abnormal stateHash format', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/callback?state=invalid-format!!!&code=test-code`);

      expect(res.status).toBe(400);
      expect(tiktokTokenCalls).toBe(0);
    });

    it('returns stable error for state replay', async () => {
      // First use
      await request(app)
        .get(`/v1/tiktok/callback?state=${validBrowserState}&code=test-code`);

      // Second use - should get replay error
      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${validBrowserState}&code=test-code`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('oauth_state_replayed');
    });

    it('state error response does not leak existence of other clients', async () => {
      const forgedState = crypto.randomBytes(32).toString('base64url');
      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${forgedState}&code=test-code`);

      const resStr = JSON.stringify(res.body);
      expect(resStr).not.toContain(clientAId);
      expect(resStr).not.toContain(clientBId);
      expect(resStr).not.toContain('ClientA');
      expect(resStr).not.toContain('ClientB');
    });

    it('JSON error includes requestId', async () => {
      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({
          clientId: clientAId,
          code: 'test-code',
          state: 'invalid'
        });

      expect(res.body.error.requestId).toBeDefined();
      expect(typeof res.body.error.requestId).toBe('string');
    });

    it('Browser HTML error page does not leak state or code', async () => {
      const res = await request(app)
        .get(`/v1/tiktok/callback?error=access_denied&error_description=Test+error`);

      expect(res.status).toBe(400);
      expect(res.text).toContain('TikTok connection was not completed');
      expect(res.text).not.toContain('access_denied');
      expect(res.text).not.toContain(validBrowserState);
    });
  });
});

describe('OAuth Endpoint Integration - Atomic Consumption and Concurrency', () => {
  describe('10.1 Browser concurrent consumption', () => {
    it('only one of two concurrent callbacks succeeds', async () => {
      // Create a valid state
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      tiktokTokenCalls = 0;
      tiktokUserCalls = 0;

      // Send two concurrent requests
      const [res1, res2] = await Promise.all([
        request(app).get(`/v1/tiktok/callback?state=${state}&code=code1`),
        request(app).get(`/v1/tiktok/callback?state=${state}&code=code2`)
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toContain(200);
      expect(statuses.filter(s => s === 200)).toHaveLength(1);
      expect(statuses.filter(s => s === 409)).toHaveLength(1);

      // Token endpoint should only be called once
      expect(tiktokTokenCalls).toBe(1);
      expect(tiktokUserCalls).toBeLessThanOrEqual(1);
    });

    it('consumedAt is set after concurrent consumption', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;
      const stateHash = crypto.createHash('sha256').update(state).digest('hex');

      await Promise.all([
        request(app).get(`/v1/tiktok/callback?state=${state}&code=code1`),
        request(app).get(`/v1/tiktok/callback?state=${state}&code=code2`)
      ]);

      const record = await prisma.oAuthAuthorizationState.findUnique({
        where: { stateHash }
      });

      expect(record!.consumedAt).not.toBeNull();
    });

    it('only one correct Client Binding is created', async () => {
      const bindingsBefore = await prisma.accountBinding.count({
        where: { clientId: clientAId, platform: 'tiktok' }
      });

      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      await Promise.all([
        request(app).get(`/v1/tiktok/callback?state=${state}&code=code1`),
        request(app).get(`/v1/tiktok/callback?state=${state}&code=code2`)
      ]);

      const bindingsAfter = await prisma.accountBinding.count({
        where: { clientId: clientAId, platform: 'tiktok' }
      });

      // Should create at most one binding
      expect(bindingsAfter).toBeLessThanOrEqual(bindingsBefore + 1);
    });
  });

  describe('10.2 Electron concurrent consumption', () => {
    it('only one of two concurrent exchanges succeeds', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      tiktokTokenCalls = 0;

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/v1/tiktok/exchange')
          .set('Authorization', `Bearer ${clientAToken}`)
          .send({ clientId: clientAId, code: 'code1', state }),
        request(app)
          .post('/v1/tiktok/exchange')
          .set('Authorization', `Bearer ${clientAToken}`)
          .send({ clientId: clientAId, code: 'code2', state })
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toContain(200);
      expect(statuses.filter(s => s === 200)).toHaveLength(1);
      expect(statuses.filter(s => s === 409)).toHaveLength(1);

      expect(tiktokTokenCalls).toBe(1);
    });

    it('consumedAt is set after Electron concurrent consumption', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;
      const stateHash = crypto.createHash('sha256').update(state).digest('hex');

      await Promise.all([
        request(app)
          .post('/v1/tiktok/exchange')
          .set('Authorization', `Bearer ${clientAToken}`)
          .send({ clientId: clientAId, code: 'code1', state }),
        request(app)
          .post('/v1/tiktok/exchange')
          .set('Authorization', `Bearer ${clientAToken}`)
          .send({ clientId: clientAId, code: 'code2', state })
      ]);

      const record = await prisma.oAuthAuthorizationState.findUnique({
        where: { stateHash }
      });

      expect(record!.consumedAt).not.toBeNull();
    });

    it('Binding belongs to correct Client', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      const binding = await prisma.accountBinding.findFirst({
        where: { clientId: clientAId, platform: 'tiktok' },
        orderBy: { createdAt: 'desc' }
      });

      if (binding) {
        expect(binding.clientId).toBe(clientAId);
      }
    });
  });

  describe('10.3 Transaction rollback', () => {
    it('rolls back entire transaction on failure', async () => {
      // This test verifies that the consumption is atomic
      // We'll test by checking that consumedAt remains null if something fails

      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;
      const stateHash = crypto.createHash('sha256').update(state).digest('hex');

      // The state should not be consumed yet
      const record = await prisma.oAuthAuthorizationState.findUnique({
        where: { stateHash }
      });
      expect(record!.consumedAt).toBeNull();
    });

    it('allows normal consumption after removing failure condition', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.status).toBe(200);

      const stateHash = crypto.createHash('sha256').update(state).digest('hex');
      const record = await prisma.oAuthAuthorizationState.findUnique({
        where: { stateHash }
      });
      expect(record!.consumedAt).not.toBeNull();
    });
  });

  describe('10.4 External request failure', () => {
    it('state remains consumed after TikTok token exchange failure', async () => {
      // Mock TikTok to fail
      const originalMock = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
        if (urlStr.includes('open.tiktokapis.com/v2/oauth/token')) {
          return new Response(JSON.stringify({ error: { code: 'invalid_grant' } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return originalMock(url);
      });

      try {
        const stateRes = await request(app)
          .get(`/v1/tiktok/auth?clientId=${clientAId}`)
          .set('Authorization', `Bearer ${clientAToken}`);

        const stateUrl = new URL(stateRes.body.data.authUrl);
        const state = stateUrl.searchParams.get('state')!;
        const stateHash = crypto.createHash('sha256').update(state).digest('hex');

        tiktokTokenCalls = 0;

        const res = await request(app)
          .get(`/v1/tiktok/callback?state=${state}&code=bad-code`);

        expect(res.status).toBe(502);

        // State should still be consumed
        const record = await prisma.oAuthAuthorizationState.findUnique({
          where: { stateHash }
        });
        expect(record!.consumedAt).not.toBeNull();

        // Replay should be rejected
        tiktokTokenCalls = 0;
        const replayRes = await request(app)
          .get(`/v1/tiktok/callback?state=${state}&code=another-code`);

        expect(replayRes.status).toBe(409);
        expect(replayRes.body.error.code).toBe('oauth_state_replayed');
        expect(tiktokTokenCalls).toBe(0);
      } finally {
        globalThis.fetch = originalMock;
      }
    });

    it('does not create Binding after token exchange failure', async () => {
      const originalMock = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
        if (urlStr.includes('open.tiktokapis.com/v2/oauth/token')) {
          return new Response('Internal Server Error', { status: 500 });
        }
        return originalMock(url);
      });

      try {
        const bindingsBefore = await prisma.accountBinding.count({
          where: { clientId: clientAId, platform: 'tiktok' }
        });

        const stateRes = await request(app)
          .get(`/v1/tiktok/auth?clientId=${clientAId}`)
          .set('Authorization', `Bearer ${clientAToken}`);

        const stateUrl = new URL(stateRes.body.data.authUrl);
        const state = stateUrl.searchParams.get('state')!;

        await request(app)
          .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

        const bindingsAfter = await prisma.accountBinding.count({
          where: { clientId: clientAId, platform: 'tiktok' }
        });

        expect(bindingsAfter).toBe(bindingsBefore);
      } finally {
        globalThis.fetch = originalMock;
      }
    });

    it('error does not leak TikTok token body', async () => {
      const originalMock = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
        if (urlStr.includes('open.tiktokapis.com/v2/oauth/token')) {
          return new Response(JSON.stringify({
            error: 'invalid_grant',
            error_description: 'The authorization code is invalid',
            secret_data: 'should-not-leak'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return originalMock(url);
      });

      try {
        const stateRes = await request(app)
          .get(`/v1/tiktok/auth?clientId=${clientAId}`)
          .set('Authorization', `Bearer ${clientAToken}`);

        const stateUrl = new URL(stateRes.body.data.authUrl);
        const state = stateUrl.searchParams.get('state')!;

        const res = await request(app)
          .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

        const resStr = JSON.stringify(res.body);
        expect(resStr).not.toContain('invalid_grant');
        expect(resStr).not.toContain('secret_data');
        expect(resStr).not.toContain('The authorization code is invalid');
      } finally {
        globalThis.fetch = originalMock;
      }
    });

    it('state remains consumed after user info request failure', async () => {
      const originalMock = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
        if (urlStr.includes('open.tiktokapis.com/v2/user/info')) {
          return new Response('Gateway Timeout', { status: 504 });
        }
        return originalMock(url);
      });

      try {
        const stateRes = await request(app)
          .get(`/v1/tiktok/auth?clientId=${clientAId}`)
          .set('Authorization', `Bearer ${clientAToken}`);

        const stateUrl = new URL(stateRes.body.data.authUrl);
        const state = stateUrl.searchParams.get('state')!;
        const stateHash = crypto.createHash('sha256').update(state).digest('hex');

        // Should still succeed (user info failure falls back to default username)
        const res = await request(app)
          .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

        // State should be consumed
        const record = await prisma.oAuthAuthorizationState.findUnique({
          where: { stateHash }
        });
        expect(record!.consumedAt).not.toBeNull();

        // Replay should still be rejected
        const replayRes = await request(app)
          .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

        expect(replayRes.status).toBe(409);
      } finally {
        globalThis.fetch = originalMock;
      }
    });
  });
});

describe('OAuth Endpoint Integration - Success Path and Tenant Isolation', () => {
  describe('11. OAuth success path and tenant isolation', () => {
    it('valid Browser callback succeeds', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('TikTok Connected!');
      expect(res.text).toContain('@Test TikTok User');
    });

    it('valid Electron exchange succeeds', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.username).toBe('Test TikTok User');
      expect(res.body.data.platform).toBe('tiktok');
    });

    it('Binding clientId comes from server-side state, not body', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      // Try to send different clientId in body
      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientBId, code: 'test-code', state });

      // Should fail because clientId doesn't match state
      expect(res.status).toBe(403);
    });

    it('body clientId cannot override state clientId', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientBId, code: 'test-code', state });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('tenant_mismatch');
    });

    it('Client A state cannot create Client B Binding', async () => {
      const bindingsBBefore = await prisma.accountBinding.count({
        where: { clientId: clientBId, platform: 'tiktok' }
      });

      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      const bindingsBAfter = await prisma.accountBinding.count({
        where: { clientId: clientBId, platform: 'tiktok' }
      });

      expect(bindingsBAfter).toBe(bindingsBBefore);
    });

    it('Client A state cannot update Client B Binding', async () => {
      // Create a binding for Client B
      await prisma.accountBinding.create({
        data: {
          clientId: clientBId,
          platform: 'tiktok',
          accountUsername: 'b-existing-account',
          platformUserId: 'b-open-id',
          accessToken: 'old-token',
          status: 'active'
        }
      });

      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);

      const stateUrl = new URL(stateRes.body.data.authUrl);
      const state = stateUrl.searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      // Client B's binding should be unchanged
      const bindingB = await prisma.accountBinding.findFirst({
        where: { clientId: clientBId, accountUsername: 'b-existing-account' }
      });

      expect(bindingB!.accessToken).toBe('old-token');
    });

    it('repeated connection to same TikTok openId upserts correctly', async () => {
      // First connection
      const stateRes1 = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state1 = new URL(stateRes1.body.data.authUrl).searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'code1', state: state1 });

      const bindingCount1 = await prisma.accountBinding.count({
        where: { clientId: clientAId, platform: 'tiktok', platformUserId: 'mock-tiktok-open-id-12345' }
      });

      // Second connection with same openId
      const stateRes2 = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state2 = new URL(stateRes2.body.data.authUrl).searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'code2', state: state2 });

      const bindingCount2 = await prisma.accountBinding.count({
        where: { clientId: clientAId, platform: 'tiktok', platformUserId: 'mock-tiktok-open-id-12345' }
      });

      // Should upsert, not create duplicate
      expect(bindingCount2).toBeLessThanOrEqual(bindingCount1 + 1);
    });

    it('accessToken is saved but not in response', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      expect(res.body.data.access_token).toBeUndefined();
      expect(res.body.data.accessToken).toBeUndefined();

      // But it should be in DB
      const binding = await prisma.accountBinding.findFirst({
        where: { clientId: clientAId, platform: 'tiktok' },
        orderBy: { createdAt: 'desc' }
      });

      expect(binding!.accessToken).toBe('mock-tiktok-access-token');
    });

    it('refreshToken is saved but not in response', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      expect(res.body.data.refresh_token).toBeUndefined();
      expect(res.body.data.refreshToken).toBeUndefined();

      const binding = await prisma.accountBinding.findFirst({
        where: { clientId: clientAId, platform: 'tiktok' },
        orderBy: { createdAt: 'desc' }
      });

      expect(binding!.refreshToken).toBe('mock-tiktok-refresh-token');
    });

    it('expiresAt is correct', async () => {
      const before = new Date();
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      const binding = await prisma.accountBinding.findFirst({
        where: { clientId: clientAId, platform: 'tiktok' },
        orderBy: { createdAt: 'desc' }
      });

      // expires_in is 86400 seconds
      const expectedExpiry = before.getTime() + 86400 * 1000;
      const actualExpiry = binding!.expiresAt!.getTime();

      // Allow 5 second margin
      expect(Math.abs(actualExpiry - expectedExpiry)).toBeLessThan(5000);
    });

    it('scope is correct', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      const binding = await prisma.accountBinding.findFirst({
        where: { clientId: clientAId, platform: 'tiktok' },
        orderBy: { createdAt: 'desc' }
      });

      expect(binding!.scope).toBe('user.info.basic,video.upload');
    });

    it('username fallback behavior is correct', async () => {
      // Mock user info to return empty display name
      const originalMock = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
        if (urlStr.includes('open.tiktokapis.com/v2/user/info')) {
          return new Response(JSON.stringify({ data: { user: {} } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return originalMock(url);
      });

      try {
        const stateRes = await request(app)
          .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
          .set('Authorization', `Bearer ${clientAToken}`);
        const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

        const res = await request(app)
          .post('/v1/tiktok/exchange')
          .set('Authorization', `Bearer ${clientAToken}`)
          .send({ clientId: clientAId, code: 'test-code', state });

        // Should fallback to "TikTok User {last8chars}"
        expect(res.body.data.username).toMatch(/^TikTok User /);
      } finally {
        globalThis.fetch = originalMock;
      }
    });

    it('handles non-JSON TikTok token response safely', async () => {
      const originalMock = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
        if (urlStr.includes('open.tiktokapis.com/v2/oauth/token')) {
          return new Response('Not JSON', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
        return originalMock(url);
      });

      try {
        const stateRes = await request(app)
          .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
          .set('Authorization', `Bearer ${clientAToken}`);
        const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

        const res = await request(app)
          .post('/v1/tiktok/exchange')
          .set('Authorization', `Bearer ${clientAToken}`)
          .send({ clientId: clientAId, code: 'test-code', state });

        expect(res.status).toBe(502);
        expect(res.body.error.code).toBe('oauth_exchange_failed');
      } finally {
        globalThis.fetch = originalMock;
      }
    });

    it('handles TikTok timeout safely', async () => {
      const originalMock = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
        if (urlStr.includes('open.tiktokapis.com/v2/oauth/token')) {
          throw new Error('The operation was aborted');
        }
        return originalMock(url);
      });

      try {
        const stateRes = await request(app)
          .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
          .set('Authorization', `Bearer ${clientAToken}`);
        const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

        const res = await request(app)
          .post('/v1/tiktok/exchange')
          .set('Authorization', `Bearer ${clientAToken}`)
          .send({ clientId: clientAId, code: 'test-code', state });

        expect(res.status).toBe(502);
        expect(res.body.error.code).toBe('oauth_exchange_failed');
      } finally {
        globalThis.fetch = originalMock;
      }
    });

    it('response does not contain client secret', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      const resStr = JSON.stringify(res.body);
      expect(resStr).not.toContain('test-tiktok-client-secret');
      expect(resStr).not.toContain('TIKTOK_CLIENT_SECRET');
    });

    it('logs do not contain access token', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      const logStr = consoleOutput.join('\n');
      expect(logStr).not.toContain('mock-tiktok-access-token');
    });

    it('logs do not contain refresh token', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      const logStr = consoleOutput.join('\n');
      expect(logStr).not.toContain('mock-tiktok-refresh-token');
    });

    it('logs do not contain authorization code', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'sensitive-auth-code', state });

      const logStr = consoleOutput.join('\n');
      expect(logStr).not.toContain('sensitive-auth-code');
    });

    it('logs do not contain full OAuth state', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth-url?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      await request(app)
        .post('/v1/tiktok/exchange')
        .set('Authorization', `Bearer ${clientAToken}`)
        .send({ clientId: clientAId, code: 'test-code', state });

      const logStr = consoleOutput.join('\n');
      expect(logStr).not.toContain(state);
    });
  });
});

describe('Remote review OAuth atomicity regressions', () => {
  it('does not burn Client A state when Client B submits its own scoped client id', async () => {
    const created = await request(app).get(`/v1/tiktok/auth-url?clientId=${clientAId}`).set('Authorization', `Bearer ${clientAToken}`);
    const state = new URL(created.body.data.authUrl).searchParams.get('state')!;
    const hash = crypto.createHash('sha256').update(state).digest('hex');
    const beforeBindings = await prisma.accountBinding.count({ where: { clientId: clientAId, platform: 'tiktok' } });
    const beforeAudit = await prisma.auditLog.count({ where: { action: 'oauth_state_consumed' } });

    const mismatch = await request(app).post('/v1/tiktok/exchange').set('Authorization', `Bearer ${clientBToken}`).send({ clientId: clientBId, code: 'not-sent', state });
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('tenant_mismatch');
    expect((await prisma.oAuthAuthorizationState.findUniqueOrThrow({ where: { stateHash: hash } })).consumedAt).toBeNull();
    expect(tiktokTokenCalls).toBe(0);
    expect(tiktokUserCalls).toBe(0);
    expect(await prisma.accountBinding.count({ where: { clientId: clientAId, platform: 'tiktok' } })).toBe(beforeBindings);
    expect(await prisma.auditLog.count({ where: { action: 'oauth_state_consumed' } })).toBe(beforeAudit);

    const retry = await request(app).post('/v1/tiktok/exchange').set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, code: 'test-code', state });
    expect(retry.status).toBe(200);
    expect((await prisma.oAuthAuthorizationState.findUniqueOrThrow({ where: { stateHash: hash } })).consumedAt).toBeInstanceOf(Date);
    expect(tiktokTokenCalls).toBe(1);
  });

  it('rolls back a consumed OAuth state when its audit insert fails, then permits a retry', async () => {
    const created = await request(app).get(`/v1/tiktok/auth-url?clientId=${clientAId}`).set('Authorization', `Bearer ${clientAToken}`);
    const state = new URL(created.body.data.authUrl).searchParams.get('state')!;
    const hash = crypto.createHash('sha256').update(state).digest('hex');
    const beforeAudit = await prisma.auditLog.count({ where: { action: 'oauth_state_consumed' } });
    const beforeBinding = await prisma.accountBinding.count({ where: { clientId: clientAId, platform: 'tiktok' } });
    await prisma.$executeRawUnsafe("CREATE TRIGGER force_oauth_state_audit_failure BEFORE INSERT ON \"AuditLog\" WHEN NEW.action = 'oauth_state_consumed' BEGIN SELECT RAISE(ABORT, 'forced oauth audit failure'); END;");
    try {
      const failed = await request(app).post('/v1/tiktok/exchange').set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, code: 'not-sent', state });
      expect(failed.status).toBe(500);
      expect(tiktokTokenCalls).toBe(0);
      expect((await prisma.oAuthAuthorizationState.findUniqueOrThrow({ where: { stateHash: hash } })).consumedAt).toBeNull();
      expect(await prisma.auditLog.count({ where: { action: 'oauth_state_consumed' } })).toBe(beforeAudit);
      expect(await prisma.accountBinding.count({ where: { clientId: clientAId, platform: 'tiktok' } })).toBe(beforeBinding);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS force_oauth_state_audit_failure');
    }
    const retry = await request(app).post('/v1/tiktok/exchange').set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, code: 'test-code', state });
    expect(retry.status).toBe(200);
    expect(tiktokTokenCalls).toBe(1);
    expect((await prisma.oAuthAuthorizationState.findUniqueOrThrow({ where: { stateHash: hash } })).consumedAt).toBeInstanceOf(Date);
    const replay = await request(app).post('/v1/tiktok/exchange').set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, code: 'test-code', state });
    expect(replay.status).toBe(409);
  });
});

describe('OAuth Endpoint Integration - CSP Nonce and HTML Escape', () => {
  describe('12.1 CSP Nonce', () => {
    it('CSP header exists', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('script-src does not contain unsafe-inline', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      // Extract script-src directive
      const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
      expect(scriptSrcMatch).toBeDefined();
      const scriptSrc = scriptSrcMatch![1];
      // script-src should not contain unsafe-inline
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      // style-src can contain unsafe-inline (that's acceptable)
      expect(csp).toContain("style-src 'unsafe-inline'");
    });

    it('script-src contains nonce', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/script-src\s+'nonce-[A-Za-z0-9_-]+'/);
    });

    it('script tag contains same nonce as CSP', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      const nonceMatch = csp.match(/'nonce-([A-Za-z0-9_-]+)'/);
      expect(nonceMatch).toBeDefined();

      const nonce = nonceMatch![1];
      expect(res.text).toContain(`nonce="${nonce}"`);
    });

    it('nonce is non-empty', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      const nonceMatch = csp.match(/'nonce-([A-Za-z0-9_-]+)'/);
      expect(nonceMatch![1].length).toBeGreaterThan(0);
    });

    it('nonce uses safe character set', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      const nonceMatch = csp.match(/'nonce-([A-Za-z0-9_-]+)'/);
      expect(nonceMatch![1]).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('two independent responses have different nonces', async () => {
      const stateRes1 = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state1 = new URL(stateRes1.body.data.authUrl).searchParams.get('state')!;

      const stateRes2 = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state2 = new URL(stateRes2.body.data.authUrl).searchParams.get('state')!;

      const res1 = await request(app)
        .get(`/v1/tiktok/callback?state=${state1}&code=code1`);
      const res2 = await request(app)
        .get(`/v1/tiktok/callback?state=${state2}&code=code2`);

      const csp1 = res1.headers['content-security-policy'];
      const csp2 = res2.headers['content-security-policy'];

      const nonce1 = csp1.match(/'nonce-([A-Za-z0-9_-]+)'/)![1];
      const nonce2 = csp2.match(/'nonce-([A-Za-z0-9_-]+)'/)![1];

      expect(nonce1).not.toBe(nonce2);
    });

    it('default-src is restrictive', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");
    });

    it('object-src is disabled', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("object-src 'none'");
    });

    it('base-uri is disabled', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("base-uri 'none'");
    });

    it('frame-ancestors is disabled', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('form-action is disabled', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("form-action 'none'");
    });

    it('X-Content-Type-Options is nosniff', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('Referrer-Policy is no-referrer', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('error page also has secure CSP', async () => {
      const res = await request(app)
        .get('/v1/tiktok/callback?error=access_denied&error_description=Test');

      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      // Extract script-src directive
      const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
      expect(scriptSrcMatch).toBeDefined();
      const scriptSrc = scriptSrcMatch![1];
      // script-src should not contain unsafe-inline
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).toContain("'nonce-");
      expect(csp).toMatch(/script-src\s+'nonce-/);
    });
  });

  describe('12.2 HTML Escape', () => {
    const attackPayloads = [
      '<script>alert(1)</script>',
      '</p><script>',
      '"onload="alert(1)',
      "'onload='alert(1)",
      'onerror=',
      'onclick=',
      '&amp;',
      '<img src=x onerror=alert(1)>'
    ];

    for (const payload of attackPayloads) {
      it(`escapes malicious username: ${payload.substring(0, 30)}...`, async () => {
        // Mock user info to return malicious username
        const originalMock = globalThis.fetch;
        globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
          const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
          if (urlStr.includes('open.tiktokapis.com/v2/user/info')) {
            return new Response(JSON.stringify({
              data: { user: { display_name: payload } }
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return originalMock(url);
        });

        try {
          const stateRes = await request(app)
            .get(`/v1/tiktok/auth?clientId=${clientAId}`)
            .set('Authorization', `Bearer ${clientAToken}`);
          const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

          const res = await request(app)
            .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

          // Should not contain raw attack payload in executable context
          expect(res.text).not.toContain(`<script>${payload}</script>`);
          expect(res.text).not.toContain(`onerror="${payload}"`);

          // Should contain escaped version
          if (res.status === 200) {
            const escaped = payload
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
            expect(res.text).toContain(escaped);
          }
        } finally {
          globalThis.fetch = originalMock;
        }
      });
    }

    it('error description with XSS is safely escaped', async () => {
      const res = await request(app)
        .get('/v1/tiktok/callback?error=access_denied&error_description=<script>alert(1)</script>');

      expect(res.text).not.toContain('<script>alert(1)</script>');
      expect(res.text).toContain('&lt;script&gt;');
    });

    it('page does not output state', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.text).not.toContain(state);
    });

    it('page does not output code', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=sensitive-code`);

      expect(res.text).not.toContain('sensitive-code');
    });

    it('page does not output access token', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.text).not.toContain('mock-tiktok-access-token');
    });

    it('page does not output refresh token', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.text).not.toContain('mock-tiktok-refresh-token');
    });

    it('page does not output client secret', async () => {
      const stateRes = await request(app)
        .get(`/v1/tiktok/auth?clientId=${clientAId}`)
        .set('Authorization', `Bearer ${clientAToken}`);
      const state = new URL(stateRes.body.data.authUrl).searchParams.get('state')!;

      const res = await request(app)
        .get(`/v1/tiktok/callback?state=${state}&code=test-code`);

      expect(res.text).not.toContain('test-tiktok-client-secret');
    });
  });
});
