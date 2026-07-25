import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

vi.mock('dotenv/config', () => ({}));
const publisherMock = vi.hoisted(() => ({ publishToTikTok: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/publisher', () => publisherMock);

const testDirectory = mkdtempSync(path.join(tmpdir(), 'publishos-phase1a-'));
const testDatabase = path.join(testDirectory, 'gateway.db');
const testDatabaseUrl = `file:${testDatabase}`;
const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = path.join(gatewayRoot, 'node_modules', '.bin', 'prisma');
const execFileAsync = promisify(execFile);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'phase1a-test-secret-that-is-at-least-32-bytes';
process.env.DATABASE_URL = testDatabaseUrl;

let app: ReturnType<typeof import('../src/app').createApp>;
let prisma: typeof import('../src/lib/prisma').prisma;
let adminToken = '';
let clientAToken = '';
let clientBToken = '';
let clientAId = '';
let clientBId = '';
let contentAId = '';

async function pushTemporaryDatabase(): Promise<void> {
  // Prisma 7's SQLite connectivity preflight requires the file to exist.
  closeSync(openSync(testDatabase, 'w'));

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
    const exitCode = typeof error?.code === 'number' ? error.code : 'unknown';
    throw new Error([
      `Temporary Prisma db push failed (exit ${exitCode}).`,
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

  const password = await bcrypt.hash('test-password', 4);
  const admin = await prisma.admin.create({ data: { name: 'Admin', email: 'admin@test.local', password } });
  const clientA = await prisma.client.create({ data: { name: 'A', email: 'a@test.local', password } });
  const clientB = await prisma.client.create({ data: { name: 'B', email: 'b@test.local', password } });
  clientAId = clientA.id;
  clientBId = clientB.id;
  const contentA = await prisma.content.create({ data: { clientId: clientA.id, title: 'A content', description: 'test', videoUrl: 'mock/a.mp4', platforms: '["tiktok"]', status: 'delivered' } });
  contentAId = contentA.id;
  const contentB = await prisma.content.create({ data: { clientId: clientB.id, title: 'B content', description: 'test', videoUrl: 'mock/b.mp4', platforms: '["tiktok"]', status: 'delivered' } });
  await prisma.accountBinding.create({ data: { clientId: clientA.id, platform: 'tiktok', accountUsername: 'a-account', accessToken: 'test-only-access-token' } });
  const bindingB = await prisma.accountBinding.create({ data: { clientId: clientB.id, platform: 'tiktok', accountUsername: 'b-account' } });
  await prisma.publishJob.create({ data: { contentId: contentB.id, accountBindingId: bindingB.id, platform: 'tiktok', status: 'dispatched' } });
  adminToken = (await request(app).post('/v1/auth/admin/login').send({ email: admin.email, password: 'test-password' })).body.data.token;
  clientAToken = (await request(app).post('/v1/auth/login').send({ email: clientA.email, password: 'test-password' })).body.data.token;
  clientBToken = (await request(app).post('/v1/auth/login').send({ email: clientB.email, password: 'test-password' })).body.data.token;
}, 30_000);

afterAll(async () => {
  try {
    await prisma?.$disconnect();
  } finally {
    rmSync(testDirectory, { recursive: true, force: true });
  }
});

describe('Phase 1A authentication and tenant isolation', () => {
  it('fails closed for missing or short secrets', async () => {
    const { loadSecurityConfig } = await import('../src/config/security');
    expect(() => loadSecurityConfig({ NODE_ENV: 'production' })).toThrow('JWT_SECRET');
    expect(() => loadSecurityConfig({ JWT_SECRET: 'short' })).toThrow('32 bytes');
  });

  it('issues the agreed admin and client claims', async () => {
    const jwt = await import('jsonwebtoken');
    const { issueToken } = await import('../src/routes/auth');
    const secret = process.env.JWT_SECRET!;
    const admin = jwt.verify(adminToken, secret) as jwt.JwtPayload;
    const client = jwt.verify(clientAToken, secret) as jwt.JwtPayload;
    expect(admin).toMatchObject({ tokenType: 'admin', role: 'admin', sub: expect.any(String), iss: 'publishos', aud: 'publishos-api', jti: expect.any(String) });
    expect(client).toMatchObject({ tokenType: 'client', role: 'client', clientId: clientAId, sub: clientAId, iss: 'publishos', aud: 'publishos-api', jti: expect.any(String) });
    const device = jwt.verify(issueToken({ tokenType: 'device', sub: 'device-claim', deviceId: 'device-claim', clientId: clientAId, role: 'device' }, '7d'), secret) as jwt.JwtPayload;
    const task = jwt.verify(issueToken({ tokenType: 'task', sub: 'job-claim', jobId: 'job-claim', deviceId: 'device-claim', clientId: clientAId, role: 'task' }, '24h'), secret) as jwt.JwtPayload;
    expect(device).toMatchObject({ tokenType: 'device', role: 'device', sub: 'device-claim', deviceId: 'device-claim', clientId: clientAId });
    expect(task).toMatchObject({ tokenType: 'task', role: 'task', sub: 'job-claim', jobId: 'job-claim', deviceId: 'device-claim', clientId: clientAId });
  });

  it('rejects anonymous and cross-token access', async () => {
    const anonymous = await request(app).get('/v1/client');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.requestId).toEqual(expect.any(String));
    expect((await request(app).get('/v1/client').set('Authorization', `Bearer ${clientAToken}`)).status).toBe(403);
    expect((await request(app).post('/v1/upload/video').set('Authorization', `Bearer ${clientAToken}`)).status).toBe(403);
  });

  it('scopes content to the authenticated client', async () => {
    const list = await request(app).get(`/v1/content?clientId=${clientAId}`).set('Authorization', `Bearer ${clientAToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].clientId).toBe(clientAId);
    expect(list.body.data[0].client.password).toBeUndefined();
    expect((await request(app).get(`/v1/content?clientId=${clientBId}`).set('Authorization', `Bearer ${clientAToken}`)).status).toBe(403);
    const other = await prisma.content.findFirst({ where: { clientId: clientBId } });
    expect((await request(app).get(`/v1/content/${other!.id}`).set('Authorization', `Bearer ${clientAToken}`)).status).toBe(404);
    expect((await request(app).post(`/v1/content/${other!.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, contentConfirmed: true })).status).toBe(404);
    expect((await request(app).post(`/v1/content/${contentAId}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientBId, contentConfirmed: true })).status).toBe(403);
  });

  it('limits bindings and device queue to their tenant', async () => {
    expect((await request(app).get(`/v1/tiktok/bindings/${clientBId}`).set('Authorization', `Bearer ${clientAToken}`)).status).toBe(403);
    const bindingB = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientBId } });
    expect((await request(app).delete(`/v1/tiktok/bindings/${bindingB.id}`).set('Authorization', `Bearer ${clientAToken}`)).status).toBe(404);
    const device = await request(app).post('/v1/client/register').set('Authorization', `Bearer ${clientAToken}`).send({ device_id: 'device-a' });
    expect(device.status).toBe(200);
    const queue = await request(app).get('/v1/client/queue').set('Authorization', `Bearer ${device.body.device_token}`);
    expect(queue.status).toBe(200);
    expect(queue.body.queue).toHaveLength(0);
  });

  it('guards TikTok initiation, uploads, publish jobs, and legacy routes', async () => {
    expect((await request(app).get(`/v1/tiktok/auth?clientId=${clientBId}`).set('Authorization', `Bearer ${clientAToken}`)).status).toBe(403);
    expect((await request(app).get(`/v1/tiktok/auth?clientId=${clientAId}`).set('Authorization', `Bearer ${clientAToken}`)).status).toBe(500);
    expect((await request(app).post('/v1/tiktok/exchange').set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientBId, code: 'not-used' })).status).toBe(403);
    expect((await request(app).post('/v1/tiktok/exchange').set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, code: 'not-used' })).status).toBe(500);
    expect((await request(app).get('/v1/tiktok/callback')).status).toBe(400);
    const bindingB = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientBId } });
    expect((await request(app).post('/v1/publish-jobs').set('Authorization', `Bearer ${adminToken}`).send({ content_id: contentAId, account_binding_id: bindingB.id, platform: 'tiktok' })).status).toBe(409);
    const legacy = await request(app).get(`/api/v1/contents?client_id=${clientAId}`).set('Authorization', `Bearer ${clientAToken}`);
    expect(legacy.status).toBe(200);
    expect(legacy.headers.deprecation).toBe('true');
    expect((await request(app).get(`/api/v1/contents?client_id=${clientAId}`)).status).toBe(401);
  });

  it('retains the administrator create/deliver and client confirm path without external TikTok access', async () => {
    const created = await request(app)
      .post('/v1/content')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId: clientAId, title: 'Admin-created content', description: 'test', videoUrl: 'mock/admin.mp4', platforms: ['tiktok'] });
    expect(created.status).toBe(201);
    const contentId = created.body.data.id as string;
    expect((await request(app).post(`/v1/content/${contentId}/approve`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).post(`/v1/content/${contentId}/deliver`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get(`/v1/content/${contentId}`).set('Authorization', `Bearer ${clientAToken}`)).status).toBe(200);
    expect((await request(app).post(`/v1/content/${contentId}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, contentConfirmed: true })).status).toBe(202);
    expect((await request(app).post('/v1/upload/video').set('Authorization', `Bearer ${adminToken}`)).status).toBe(400);
  });
});

describe('Ticket routes require admin authentication', () => {
  it('rejects anonymous access to tickets', async () => {
    const res = await request(app).get('/v1/tickets');
    expect(res.status).toBe(401);
  });

  it('rejects client token access to tickets', async () => {
    const res = await request(app).get('/v1/tickets').set('Authorization', `Bearer ${clientAToken}`);
    expect(res.status).toBe(403);
  });

  it('allows admin to list and create tickets', async () => {
    const list = await request(app).get('/v1/tickets').set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);

    const created = await request(app)
      .post('/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ companyName: 'Test Corp', address: '123 Main St', industry: 'plumbing' });
    expect(created.status).toBe(200);
    expect(created.body.data.companyName).toBe('Test Corp');

    const detail = await request(app).get(`/v1/tickets/${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(created.body.data.id);
  });
});

describe('Phase 1B state machines and task replay protection', () => {
  it('legacy admin publish API returns 410 Gone since customer must use Send to TikTok', async () => {
    publisherMock.publishToTikTok.mockClear();
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Legacy publish', description: 'test', videoUrl: 'mock/legacy.mp4', platforms: '["tiktok"]', status: 'delivered' } });
    const first = await request(app).post(`/api/v1/contents/${content.id}/publish`).set('Authorization', `Bearer ${adminToken}`);
    expect(first.status).toBe(410);
    expect(first.headers.deprecation).toBe('true');
    expect(first.body.error.code).toBe('client_send_required');
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).status).toBe('delivered');
    expect(await prisma.publishJob.count({ where: { contentId: content.id } })).toBe(0);
    expect(publisherMock.publishToTikTok).not.toHaveBeenCalled();
  });

  it('does not create a second legacy job after a stale delivered read races with completion', async () => {
    publisherMock.publishToTikTok.mockClear();
    const { createOrGetActivePublishJob, transitionContent, transitionJob } = await import('../src/domain/publishing-state');
    const binding = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientAId } });
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Legacy race', description: 'test', videoUrl: 'mock/legacy-race.mp4', platforms: '["tiktok"]', status: 'delivered' } });
    const originalJob = await prisma.publishJob.create({ data: { contentId: content.id, accountBindingId: binding.id, platform: 'tiktok', status: 'publishing', activeKey: `${content.id}:tiktok` } });
    const staleContent = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
    expect(staleContent.status).toBe('delivered');

    await prisma.$transaction(async (tx) => {
      const publishedAt = new Date();
      await transitionJob(tx, originalJob.id, 'publishing', 'published', { publishedAt });
      await transitionContent(tx, content.id, 'delivered', 'published', { publishedAt });
    });

    await expect(prisma.$transaction((tx) => createOrGetActivePublishJob(tx, {
      contentId: staleContent.id,
      accountBindingId: binding.id,
      platform: 'tiktok',
      dispatchWhenImmediate: false,
    }))).rejects.toMatchObject({ status: 409, code: 'invalid_state_transition' });

    const result = await request(app).post(`/api/v1/contents/${content.id}/publish`).set('Authorization', `Bearer ${adminToken}`);
    expect(result.status).toBe(410);
    expect(result.body.error.code).toBe('client_send_required');
    expect(result.headers.deprecation).toBe('true');
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).status).toBe('published');
    expect(await prisma.publishJob.count({ where: { contentId: content.id } })).toBe(1);
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: originalJob.id } })).activeKey).toBeNull();
    expect(publisherMock.publishToTikTok).not.toHaveBeenCalled();
  });

  it('legacy admin publish API returns 410 regardless of audit triggers', async () => {
    publisherMock.publishToTikTok.mockClear();
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Legacy audit rollback', description: 'test', videoUrl: 'mock/legacy-audit.mp4', platforms: '["tiktok"]', status: 'delivered' } });
    const failed = await request(app).post(`/api/v1/contents/${content.id}/publish`).set('Authorization', `Bearer ${adminToken}`);
    expect(failed.status).toBe(410);
    expect(failed.headers.deprecation).toBe('true');
    expect(await prisma.publishJob.count({ where: { contentId: content.id } })).toBe(0);
    expect(publisherMock.publishToTikTok).not.toHaveBeenCalled();
  });

  it('rolls back client send-to-tiktok when its audit insert fails and retries idempotently', async () => {
    publisherMock.publishToTikTok.mockClear();
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Client audit rollback', description: 'test', videoUrl: 'mock/client-audit.mp4', platforms: '["tiktok"]', status: 'delivered' } });
    await prisma.$executeRawUnsafe('CREATE TRIGGER force_client_publish_audit_failure BEFORE INSERT ON "AuditLog" WHEN NEW.action = \'tiktok_send_requested\' AND NEW.actorType = \'client\' BEGIN SELECT RAISE(ABORT, \'forced client audit rollback\'); END;');
    try {
      const failed = await request(app).post(`/v1/content/${content.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, contentConfirmed: true, deviceId: 'client-audit-device' });
      expect(failed.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS force_client_publish_audit_failure');
    }
    expect(await prisma.publishJob.count({ where: { contentId: content.id } })).toBe(0);
    expect(await prisma.jobHistory.count({ where: { job: { contentId: content.id } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'tiktok_send_requested', targetId: content.id, actorType: 'client' } })).toBe(0);
    expect(publisherMock.publishToTikTok).not.toHaveBeenCalled();

    const retried = await request(app).post(`/v1/content/${content.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, contentConfirmed: true, deviceId: 'client-audit-device' });
    expect(retried.status).toBe(202);
    expect(retried.body.data).toMatchObject({ idempotent: false, publishJobId: expect.any(String) });
    const duplicate = await request(app).post(`/v1/content/${content.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, contentConfirmed: true, deviceId: 'client-audit-device' });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data).toMatchObject({ idempotent: true, publishJobId: retried.body.data.publishJobId });
    expect(await prisma.publishJob.count({ where: { contentId: content.id } })).toBe(1);
    expect(await prisma.jobHistory.count({ where: { jobId: retried.body.data.publishJobId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'tiktok_send_requested', targetId: retried.body.data.publishJobId, actorType: 'client' } })).toBe(1);
    expect(publisherMock.publishToTikTok).toHaveBeenCalledTimes(1);
  });

  it('admin publish-jobs endpoint rejects TikTok platform with 409 since customer must use Send to TikTok', async () => {
    publisherMock.publishToTikTok.mockClear();
    const binding = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientAId } });
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Admin audit rollback', description: 'test', videoUrl: 'mock/admin-audit.mp4', platforms: '["tiktok"]', status: 'delivered' } });
    const body = { content_id: content.id, account_binding_id: binding.id, platform: 'tiktok' };
    const failed = await request(app).post('/v1/publish-jobs').set('Authorization', `Bearer ${adminToken}`).send(body);
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe('client_send_required');
    expect(await prisma.publishJob.count({ where: { contentId: content.id } })).toBe(0);
    expect(publisherMock.publishToTikTok).not.toHaveBeenCalled();
  });

  it('admin publish-jobs endpoint rejects TikTok platform for both approved and delivered content', async () => {
    const binding = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientAId } });
    const approved = await prisma.content.create({ data: { clientId: clientAId, title: 'Approved admin job', description: 'test', videoUrl: 'mock/approved-job.mp4', platforms: '["tiktok"]', status: 'approved' } });
    const rejected = await request(app).post('/v1/publish-jobs').set('Authorization', `Bearer ${adminToken}`).send({ content_id: approved.id, account_binding_id: binding.id, platform: 'tiktok' });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('client_send_required');

    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Immediate admin job', description: 'test', videoUrl: 'mock/immediate-job.mp4', platforms: '["tiktok"]', status: 'delivered' } });
    const body = { content_id: content.id, account_binding_id: binding.id, platform: 'tiktok' };
    const result = await request(app).post('/v1/publish-jobs').set('Authorization', `Bearer ${adminToken}`).send(body);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('client_send_required');
  });

  it('future scheduled TikTok jobs are also rejected by admin endpoint', async () => {
    const binding = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientAId } });
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Future admin job', description: 'test', videoUrl: 'mock/future-job.mp4', platforms: '["tiktok"]', status: 'delivered' } });
    const scheduledAt = new Date(Date.now() + 6 * 60_000).toISOString();
    const result = await request(app).post('/v1/publish-jobs').set('Authorization', `Bearer ${adminToken}`).send({ content_id: content.id, account_binding_id: binding.id, platform: 'tiktok', schedule_at: scheduledAt });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('client_send_required');
  });

  it('enforces content lifecycle transitions and rejects terminal creation', async () => {
    const forbidden = await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken}`).send({
      clientId: clientAId, title: 'Invalid terminal', description: 'test', videoUrl: 'mock/invalid.mp4', platforms: ['tiktok'], status: 'published',
    });
    expect(forbidden.status).toBe(422);

    const created = await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken}`).send({
      clientId: clientAId, title: 'State lifecycle', description: 'test', videoUrl: 'mock/state.mp4', platforms: ['tiktok'], status: 'pending_review',
    });
    expect(created.status).toBe(201);
    const contentId = created.body.data.id as string;
    expect((await request(app).post(`/v1/content/${contentId}/deliver`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(409);
    expect((await request(app).post(`/v1/content/${contentId}/approve`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).post(`/v1/content/${contentId}/deliver`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).post(`/v1/content/${contentId}/approve`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(409);
    await prisma.content.update({ where: { id: contentId }, data: { status: 'published' } });
    expect((await request(app).post(`/v1/content/${contentId}/deliver`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(409);
  });

  it('makes client send-to-tiktok idempotent and retains one active job', async () => {
    publisherMock.publishToTikTok.mockClear();
    const first = await request(app).post(`/v1/content/${contentAId}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, contentConfirmed: true });
    expect(first.status).toBe(202);
    expect(first.body.data.idempotent).toBe(false);
    const second = await request(app).post(`/v1/content/${contentAId}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, contentConfirmed: true });
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ publishJobId: first.body.data.publishJobId, idempotent: true });
    expect(await prisma.publishJob.count({ where: { contentId: contentAId, activeKey: `${contentAId}:tiktok` } })).toBe(1);
    expect((await prisma.content.findUniqueOrThrow({ where: { id: contentAId } })).status).toBe('delivered');
    expect(publisherMock.publishToTikTok).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent send-to-tiktok at the database constraint', async () => {
    publisherMock.publishToTikTok.mockClear();
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Concurrent confirmation', description: 'test', videoUrl: 'mock/concurrent.mp4', platforms: '[\"tiktok\"]', status: 'delivered' } });
    const responses = await Promise.all([
      request(app).post(`/v1/content/${content.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, contentConfirmed: true }),
      request(app).post(`/v1/content/${content.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId, contentConfirmed: true }),
    ]);
    expect(responses.map((response) => response.status)).toEqual(expect.arrayContaining([200, 202]));
    expect(await prisma.publishJob.count({ where: { contentId: content.id, activeKey: `${content.id}:tiktok` } })).toBe(1);
    expect(publisherMock.publishToTikTok).toHaveBeenCalledTimes(1);
  });

  it('device task claims work but TikTok task completion is blocked with 409', async () => {
    const binding = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientAId } });
    const taskContent = await prisma.content.create({ data: { clientId: clientAId, title: 'Device task', description: 'test', videoUrl: 'mock/task.mp4', platforms: '[\"tiktok\"]', status: 'delivered' } });
    const taskJob = await prisma.publishJob.create({ data: { contentId: taskContent.id, accountBindingId: binding.id, platform: 'tiktok', status: 'dispatched', activeKey: `${taskContent.id}:tiktok` } });
    const registered = await request(app).post('/v1/client/register').set('Authorization', `Bearer ${clientAToken}`).send({ device_id: 'phase1b-device' });
    expect(registered.status).toBe(200);
    const queue = await request(app).get('/v1/client/queue').set('Authorization', `Bearer ${registered.body.device_token}`);
    expect(queue.status).toBe(200);
    const queued = queue.body.queue.find((item: { job_id: string }) => item.job_id === taskJob.id);
    expect(queued).toBeDefined();
    const claimed = await prisma.publishJob.findUniqueOrThrow({ where: { id: taskJob.id } });
    expect(claimed).toMatchObject({ status: 'client_confirmed', jobToken: null, clientToken: null, taskDeviceId: 'phase1b-device', taskTokenJti: expect.any(String) });
    expect(claimed.taskTokenExpiresAt).toBeInstanceOf(Date);
    expect(claimed.jobToken).not.toBe(queued.job_token);

    const result = await request(app).post(`/v1/tasks/${taskJob.id}/status`).set('Authorization', `Bearer ${queued.job_token}`).send({ status: 'published' });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('official_tiktok_status_required');
  });

  it('TikTok task callback is blocked with 409 regardless of token validity', async () => {
    const { issueToken } = await import('../src/routes/auth');
    const binding = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientAId } });
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Guarded task', description: 'test', videoUrl: 'mock/guarded.mp4', platforms: '[\"tiktok\"]', status: 'delivered' } });
    const job = await prisma.publishJob.create({ data: { contentId: content.id, accountBindingId: binding.id, platform: 'tiktok', status: 'client_confirmed', activeKey: `${content.id}:tiktok`, taskTokenJti: 'expected-jti', taskTokenExpiresAt: new Date(Date.now() + 60_000), taskDeviceId: 'expected-device' } });
    const token = issueToken({ tokenType: 'task', sub: job.id, jobId: job.id, deviceId: 'expected-device', clientId: clientAId, role: 'task' }, '1h');
    for (const status of ['published', 'failed']) {
      expect((await request(app).post(`/v1/tasks/${job.id}/status`).set('Authorization', `Bearer ${token}`).send({ status })).status).toBe(409);
    }
    const beforeHistory = await prisma.jobHistory.count({ where: { jobId: job.id } });
    expect(await prisma.jobHistory.count({ where: { jobId: job.id } })).toBe(beforeHistory);
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('client_confirmed');
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).status).toBe('delivered');
  });

  it('TikTok task callback is blocked with 409 for failed status too', async () => {
    const binding = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientAId } });
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Failed task', description: 'test', videoUrl: 'mock/failed.mp4', platforms: '[\"tiktok\"]', status: 'delivered' } });
    const job = await prisma.publishJob.create({ data: { contentId: content.id, accountBindingId: binding.id, platform: 'tiktok', status: 'dispatched', activeKey: `${content.id}:tiktok` } });
    const device = await request(app).post('/v1/client/register').set('Authorization', `Bearer ${clientAToken}`).send({ device_id: 'failed-task-device' });
    const queue = await request(app).get('/v1/client/queue').set('Authorization', `Bearer ${device.body.device_token}`);
    const entry = queue.body.queue.find((item: { job_id: string }) => item.job_id === job.id);
    const first = await request(app).post(`/v1/tasks/${job.id}/status`).set('Authorization', `Bearer ${entry.job_token}`).send({ status: 'failed', error: { code: 'mock_failure', message: 'mock failure', retryable: true } });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('official_tiktok_status_required');
  });

  it('reissues expired device tokens and TikTok task completion is blocked with 409', async () => {
    const binding = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientAId } });
    const content = await prisma.content.create({ data: { clientId: clientAId, title: 'Reissue task', description: 'test', videoUrl: 'mock/reissue.mp4', platforms: '[\"tiktok\"]', status: 'delivered' } });
    const job = await prisma.publishJob.create({ data: { contentId: content.id, accountBindingId: binding.id, platform: 'tiktok', status: 'dispatched', activeKey: `${content.id}:tiktok` } });
    const device = await request(app).post('/v1/client/register').set('Authorization', `Bearer ${clientAToken}`).send({ device_id: 'reissue-device' });
    const firstQueue = await request(app).get('/v1/client/queue').set('Authorization', `Bearer ${device.body.device_token}`);
    const first = firstQueue.body.queue.find((item: { job_id: string }) => item.job_id === job.id);
    const firstDb = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(firstDb).toMatchObject({ jobToken: null, clientToken: null, taskTokenJti: expect.any(String), taskDeviceId: 'reissue-device' });
    expect((await request(app).get('/v1/client/queue').set('Authorization', `Bearer ${device.body.device_token}`)).body.queue).toHaveLength(0);
    await prisma.publishJob.update({ where: { id: job.id }, data: { taskTokenExpiresAt: new Date(Date.now() - 1000) } });
    const secondQueue = await request(app).get('/v1/client/queue').set('Authorization', `Bearer ${device.body.device_token}`);
    const second = secondQueue.body.queue.find((item: { job_id: string }) => item.job_id === job.id);
    const secondDb = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(second).toBeDefined();
    expect(secondDb.taskTokenJti).not.toBe(firstDb.taskTokenJti);
    expect((await request(app).post(`/v1/tasks/${job.id}/status`).set('Authorization', `Bearer ${second.job_token}`).send({ status: 'published' })).status).toBe(409);
  });

  it('only permits cancellation before publishing begins', async () => {
    const binding = await prisma.accountBinding.findFirstOrThrow({ where: { clientId: clientAId } });
    const pendingContent = await prisma.content.create({ data: { clientId: clientAId, title: 'Cancel pending', description: 'test', videoUrl: 'mock/cancel.mp4', platforms: '[\"tiktok\"]', status: 'delivered' } });
    const pending = await prisma.publishJob.create({ data: { contentId: pendingContent.id, accountBindingId: binding.id, platform: 'tiktok', status: 'pending', activeKey: `${pendingContent.id}:tiktok` } });
    expect((await request(app).post(`/v1/publish-jobs/${pending.id}/cancel`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: pending.id } })).activeKey).toBeNull();
    const uploadingContent = await prisma.content.create({ data: { clientId: clientAId, title: 'Cancel uploading', description: 'test', videoUrl: 'mock/uploading.mp4', platforms: '[\"tiktok\"]', status: 'delivered' } });
    const uploading = await prisma.publishJob.create({ data: { contentId: uploadingContent.id, accountBindingId: binding.id, platform: 'tiktok', status: 'uploading', activeKey: `${uploadingContent.id}:tiktok` } });
    expect((await request(app).post(`/v1/publish-jobs/${uploading.id}/cancel`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(409);
  });
});
