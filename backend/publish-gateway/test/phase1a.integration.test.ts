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

afterAll(async () => { await prisma?.$disconnect(); rmSync(testDirectory, { recursive: true, force: true }); });

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
    expect((await request(app).post(`/v1/content/${other!.id}/confirm`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId })).status).toBe(404);
    expect((await request(app).post(`/v1/content/${contentAId}/confirm`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientBId })).status).toBe(403);
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
    expect((await request(app).post('/v1/publish-jobs').set('Authorization', `Bearer ${adminToken}`).send({ content_id: contentAId, account_binding_id: bindingB.id, platform: 'tiktok' })).status).toBe(422);
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
    expect((await request(app).post(`/v1/content/${contentId}/deliver`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get(`/v1/content/${contentId}`).set('Authorization', `Bearer ${clientAToken}`)).status).toBe(200);
    expect((await request(app).post(`/v1/content/${contentId}/confirm`).set('Authorization', `Bearer ${clientAToken}`).send({ clientId: clientAId })).status).toBe(200);
    expect((await request(app).post('/v1/upload/video').set('Authorization', `Bearer ${adminToken}`)).status).toBe(400);
  });
});
