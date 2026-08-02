import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const directory = mkdtempSync(path.join(tmpdir(), 'publishos-ops-brain-'));
const database = path.join(directory, 'gateway.db');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = `file:${database}`;
process.env.JWT_SECRET = 'ops-brain-test-jwt-secret-at-least-32-bytes';
process.env.MEDIA_SIGNING_SECRET = 'ops-brain-test-media-secret-at-least-32-bytes';
process.env.PUBLIC_BASE_URL = 'http://example.com';
process.env.OPS_BRAIN_BRIDGE_ENABLED = 'true';
process.env.OPS_BRAIN_BRIDGE_TOKEN = 'TEST_ONLY_TOKEN_which_is_longer_than_thirty_two_bytes';

const root = path.resolve(import.meta.dirname, '..');
closeSync(openSync(database, 'w'));
execFileSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--config', './prisma.config.ts'], { cwd: root, env: process.env });

let app: ReturnType<typeof import('../src/app').createApp>;
let prisma: typeof import('../src/lib/prisma').prisma;
let clientA = '';
let clientB = '';
let admin = '';
let contentA = '';
let bindingA = '';
const ref = '2026-07-25_ab61ed09f0a1_example-title';
const bridge = `Bearer ${process.env.OPS_BRAIN_BRIDGE_TOKEN}`;
const TIMELINE_NOW = new Date('2026-07-28T00:00:00.000Z');

function adminToken() {
  return jwt.sign({ sub: admin, tokenType: 'admin', role: 'admin' }, process.env.JWT_SECRET!, { algorithm: 'HS256', issuer: 'publishos', audience: 'publishos-api', expiresIn: '1h', jwtid: 'ops-brain-admin' });
}

beforeAll(async () => {
  ({ prisma } = await import('../src/lib/prisma'));
  ({ createApp: app } = await import('../src/app'));
  app = app();
  const [adminRow, a, b] = await Promise.all([
    prisma.admin.create({ data: { name: 'Admin', email: 'admin@example.test', password: 'hash' } }),
    prisma.client.create({ data: { name: 'A', email: 'a@example.test', password: 'hash' } }),
    prisma.client.create({ data: { name: 'B', email: 'b@example.test', password: 'hash' } }),
  ]);
  admin = adminRow.id; clientA = a.id; clientB = b.id;
  const binding = await prisma.accountBinding.create({ data: { clientId: a.id, platform: 'tiktok', accountUsername: 'a', accessToken: 'safe-test-placeholder', grantedScopes: '["video.upload","video.list"]', collectionStatus: 'success', lastCollectionAttemptAt: new Date('2026-07-25T12:00:00Z'), lastCollectionSuccessAt: new Date('2026-07-25T12:01:00Z') } });
  bindingA = binding.id;
  const content = await prisma.content.create({ data: { clientId: a.id, targetAccountBindingId: binding.id, contentRef: ref, title: 'Example', description: 'desc', videoUrl: 'mock/video.mp4', platforms: '["tiktok"]', status: 'published' } });
  contentA = content.id;
  await prisma.content.create({ data: { clientId: b.id, contentRef: ref, title: 'Other tenant', description: 'desc', videoUrl: 'mock/video.mp4', platforms: '["tiktok"]' } });
  const job = await prisma.publishJob.create({ data: { contentId: content.id, accountBindingId: binding.id, platform: 'tiktok', status: 'published' } });
  const postA = await prisma.publishedPost.create({ data: { publishJobId: job.id, accountBindingId: binding.id, platform: 'tiktok', platformPostId: 'post-a', publishedAt: new Date('2026-07-20T00:00:00Z') } });
  const postB = await prisma.publishedPost.create({ data: { publishJobId: job.id, accountBindingId: binding.id, platform: 'tiktok', platformPostId: 'post-b' } });
  await prisma.performanceMetrics.createMany({ data: [
    { clientId: a.id, contentId: content.id, publishJobId: job.id, publishedPostId: postA.id, platform: 'tiktok', platformPostId: 'post-a', metricDate: '2026-07-21', views: 100, likes: 10, comments: 2, shares: 1, observedAt: new Date('2026-07-21T00:00:00Z'), collectedAt: new Date('2026-07-21T01:00:00Z') },
    { clientId: a.id, contentId: content.id, publishJobId: job.id, publishedPostId: postA.id, platform: 'tiktok', platformPostId: 'post-a', metricDate: '2026-07-25', views: 1000, likes: 100, comments: 20, shares: 10, observedAt: new Date('2026-07-25T00:00:00Z'), collectedAt: new Date('2026-07-25T01:00:00Z'), rawResponseHash: 'safe-hash' },
    { clientId: a.id, contentId: content.id, publishJobId: job.id, publishedPostId: postB.id, platform: 'tiktok', platformPostId: 'post-b', metricDate: '2026-07-25-b', views: 600, likes: null, comments: 12, shares: 6, observedAt: new Date('2026-07-25T02:00:00Z'), collectedAt: new Date('2026-07-25T03:00:00Z') },
  ] });
});

afterAll(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

describe('Phase 2B-A Ops Brain bridge', () => {
  it('validates bridge config and compares tokens without exposing them', async () => {
    const { loadOpsBrainBridgeConfig } = await import('../src/config/security');
    const { constantTimeTokenEquals } = await import('../src/middleware/ops-brain-bridge-auth');
    expect(loadOpsBrainBridgeConfig({ OPS_BRAIN_BRIDGE_ENABLED: 'false' })).toEqual({ enabled: false });
    expect(() => loadOpsBrainBridgeConfig({ OPS_BRAIN_BRIDGE_ENABLED: 'true' })).toThrow('OPS_BRAIN_BRIDGE_TOKEN');
    expect(() => loadOpsBrainBridgeConfig({ OPS_BRAIN_BRIDGE_ENABLED: 'true', OPS_BRAIN_BRIDGE_TOKEN: 'short' })).toThrow('32 bytes');
    expect(constantTimeTokenEquals('a', 'a')).toBe(true); expect(constantTimeTokenEquals('a', 'different')).toBe(false);
  });

  it('enforces bridge-only auth and read-only isolation', async () => {
    await request(app).get('/v1/integrations/ops-brain/performance').expect(401);
    await request(app).get('/v1/integrations/ops-brain/performance').set('Authorization', 'Basic x').expect(401);
    await request(app).get('/v1/integrations/ops-brain/performance').set('Authorization', `Bearer ${adminToken()}`).expect(401);
    await request(app).post('/v1/content').set('Authorization', bridge).send({}).expect(401);
  });

  it('requires exact tenant and content reference parameters', async () => {
    await request(app).get('/v1/integrations/ops-brain/performance').set('Authorization', bridge).query({ contentRef: ref }).expect(400);
    await request(app).get('/v1/integrations/ops-brain/performance').set('Authorization', bridge).query({ clientId: clientA }).expect(400);
    await request(app).get('/v1/integrations/ops-brain/performance').set('Authorization', bridge).query({ clientId: clientA, contentRef: ref, days: 366 }).expect(400);
    await request(app).get('/v1/integrations/ops-brain/performance').set('Authorization', bridge).query({ clientId: clientB, contentRef: 'not-this' }).expect(404);
  });

  it('uses a fixed UTC clock: includes the exact window boundary and excludes older snapshots', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TIMELINE_NOW);
    try {
      const response = await request(app).get('/v1/integrations/ops-brain/performance').set('Authorization', bridge).query({ clientId: clientA, contentRef: ref, days: 3 }).expect(200);
      expect(response.body.generatedAt).toBe('2026-07-28T00:00:00.000Z');
      expect(response.body.schemaVersion).toBe('publishos.ops-brain.performance.v1');
      expect(response.body.content).toMatchObject({ id: contentA, contentRef: ref, title: 'Example' });
      expect(response.body.latestTotals).toEqual({ views: 1600, likes: 100, comments: 32, shares: 16, engagementRate: 0.0925 });
      expect(response.body.posts).toHaveLength(2);
      const postA = response.body.posts.find((post: { platformPostId: string }) => post.platformPostId === 'post-a');
      const postB = response.body.posts.find((post: { platformPostId: string }) => post.platformPostId === 'post-b');
      expect(postA.snapshots).toEqual([expect.objectContaining({ observedAt: '2026-07-25T00:00:00.000Z', views: 1000 })]);
      expect(postA.snapshots).not.toContainEqual(expect.objectContaining({ observedAt: '2026-07-21T00:00:00.000Z' }));
      expect(postB.snapshots).toEqual([expect.objectContaining({ observedAt: '2026-07-25T02:00:00.000Z', views: 600, likes: null })]);
      expect(response.body.posts.flatMap((post: { snapshots: unknown[] }) => post.snapshots)).not.toContainEqual(expect.objectContaining({ accessToken: expect.anything() }));
      expect(response.body.availability).toMatchObject({ views: 'available', saves: 'unavailable_from_current_api' });
      expect(response.body.collection).toMatchObject({ status: 'success', reauthorizationRequired: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates and patches content references with aliases, tenant uniqueness, and audit history', async () => {
    const create = await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken()}`).send({ clientId: clientA, targetAccountBindingId: bindingA, title: 'Unicode', description: 'desc', content_ref: '  中文-内容_1  ' }).expect(201);
    expect(create.body.data.contentRef).toBe('中文-内容_1');
    await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken()}`).send({ clientId: clientA, targetAccountBindingId: bindingA, title: 'Conflict', description: 'desc', contentRef: '中文-内容_1' }).expect(409);
    await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken()}`).send({ clientId: clientA, title: 'Mismatch', description: 'desc', contentRef: 'a', content_ref: 'b' }).expect(422);
    const patch = await request(app).patch(`/v1/content/${contentA}/content-ref`).set('Authorization', `Bearer ${adminToken()}`).send({ contentRef: 'replacement-ref' }).expect(200);
    expect(patch.body.data.contentRef).toBe('replacement-ref');
    await request(app).patch(`/v1/content/${contentA}/content-ref`).set('Authorization', `Bearer ${adminToken()}`).send({ contentRef: null }).expect(200);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'set_content_ref', targetId: contentA }, orderBy: { createdAt: 'desc' } });
    expect(JSON.parse(audit!.details!)).toMatchObject({ contentId: contentA, oldContentRef: 'replacement-ref', newContentRef: null });
  });
});
