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

const testDirectory = mkdtempSync(path.join(tmpdir(), 'publishos-phase1b-state-'));
const testDatabase = path.join(testDirectory, 'gateway.db');
const testDatabaseUrl = `file:${testDatabase}`;
const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = path.join(gatewayRoot, 'node_modules', '.bin', 'prisma');
const execFileAsync = promisify(execFile);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'phase1b-state-test-secret-that-is-at-least-32-bytes';
process.env.DATABASE_URL = testDatabaseUrl;

let app: ReturnType<typeof import('../src/app').createApp>;
let prisma: typeof import('../src/lib/prisma').prisma;
let transitionContent: typeof import('../src/domain/publishing-state').transitionContent;
let transitionJob: typeof import('../src/domain/publishing-state').transitionJob;
let issueToken: typeof import('../src/routes/auth').issueToken;
let adminToken = '';
let clientId = '';
let bindingId = '';

async function pushTemporaryDatabase(): Promise<void> {
  closeSync(openSync(testDatabase, 'w'));
  await execFileAsync(prismaCli, ['db', 'push', '--config', './prisma.config.ts', '--schema', './prisma/schema.prisma'], {
    cwd: gatewayRoot,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function createContent(status: any) {
  return prisma.content.create({ data: {
    clientId, targetAccountBindingId: bindingId, title: `Content ${status} ${crypto.randomUUID()}`, description: 'state machine test',
    videoUrl: 'mock/state.mp4', platforms: '["tiktok"]', status,
  } });
}

async function createJob(status: any) {
  const content = await createContent('delivered');
  return prisma.publishJob.create({ data: {
    contentId: content.id, accountBindingId: bindingId, platform: 'tiktok', status,
    activeKey: `${content.id}:tiktok`,
  } });
}

beforeAll(async () => {
  await pushTemporaryDatabase();
  ({ prisma } = await import('../src/lib/prisma'));
  ({ transitionContent, transitionJob } = await import('../src/domain/publishing-state'));
  ({ issueToken } = await import('../src/routes/auth'));
  const { createApp } = await import('../src/app');
  app = createApp();
  const password = await bcrypt.hash('test-password', 4);
  const admin = await prisma.admin.create({ data: { name: 'State Admin', email: 'state-admin@test.local', password } });
  const client = await prisma.client.create({ data: { name: 'State Client', email: 'state-client@test.local', password } });
  clientId = client.id;
  bindingId = (await prisma.accountBinding.create({ data: {
    clientId, platform: 'tiktok', accountUsername: 'state-machine-account', accessToken: 'safe-test-placeholder', grantedScopes: '["video.upload","video.list"]',
  } })).id;
  adminToken = (await request(app).post('/v1/auth/admin/login').send({ email: admin.email, password: 'test-password' })).body.data.token;
});

afterAll(async () => {
  try {
    await prisma?.$disconnect();
  } finally {
    rmSync(testDirectory, { recursive: true, force: true });
  }
});

describe('Phase 1B content state matrix', () => {
  const allowed: Array<[any, any]> = [
    ['draft', 'pending_review'], ['draft', 'approved'], ['pending_review', 'approved'],
    ['pending_review', 'rejected'], ['rejected', 'pending_review'], ['rejected', 'approved'],
    ['approved', 'delivered'], ['failed', 'delivered'], ['delivered', 'published'], ['delivered', 'failed'],
  ];
  const invalid: Array<[any, any]> = [
    ['published', 'draft'], ['published', 'pending_review'], ['published', 'approved'], ['published', 'rejected'],
    ['published', 'delivered'], ['published', 'failed'], ['delivered', 'approved'], ['delivered', 'rejected'],
    ['draft', 'delivered'], ['pending_review', 'delivered'], ['approved', 'published'], ['rejected', 'delivered'],
    ['failed', 'published'],
  ];

  it('creates only draft and pending_review content', async () => {
    for (const status of ['draft', 'pending_review']) {
      const result = await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken}`).send({
        clientId, targetAccountBindingId: bindingId, title: `create ${status}`, description: 'creation matrix', status,
      });
      expect(result.status).toBe(201);
      expect(result.body.data.status).toBe(status);
    }
    for (const status of ['published', 'failed', 'delivered']) {
      const result = await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken}`).send({
        clientId, title: `reject ${status}`, description: 'creation matrix', status,
      });
      expect(result.status).toBe(422);
    }
  });

  it('persists every allowed content transition through the shared state helper', async () => {
    for (const [from, to] of allowed) {
      const content = await createContent(from);
      await prisma.$transaction((tx) => transitionContent(tx, content.id, from, to));
      expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).status, `${from} -> ${to}`).toBe(to);
    }
  });

  it('rejects invalid content transitions with 409 and no database side effect', async () => {
    for (const [from, to] of invalid) {
      const content = await createContent(from);
      const auditBefore = await prisma.auditLog.count({ where: { targetId: content.id } });
      await expect(prisma.$transaction((tx) => transitionContent(tx, content.id, from, to)), `${from} -> ${to}`)
        .rejects.toMatchObject({ status: 409, code: 'invalid_state_transition' });
      expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).status).toBe(from);
      expect(await prisma.auditLog.count({ where: { targetId: content.id } })).toBe(auditBefore);
    }
  });

  it('keeps legacy approve and reject on the shared state machine and deprecated surface', async () => {
    const approvable = await createContent('pending_review');
    const approved = await request(app).post(`/api/v1/contents/${approvable.id}/approve`).set('Authorization', `Bearer ${adminToken}`);
    expect(approved.status).toBe(200);
    expect(approved.headers.deprecation).toBe('true');
    expect((await prisma.content.findUniqueOrThrow({ where: { id: approvable.id } })).status).toBe('approved');

    const terminal = await createContent('published');
    const rejected = await request(app).post(`/api/v1/contents/${terminal.id}/reject`).set('Authorization', `Bearer ${adminToken}`);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('invalid_state_transition');
    expect((await prisma.content.findUniqueOrThrow({ where: { id: terminal.id } })).status).toBe('published');
  });
});

describe('Phase 1B publish job state matrix', () => {
  const allowed: Array<[any, any]> = [
    ['pending', 'dispatched'], ['pending', 'uploading'], ['pending', 'failed'], ['pending', 'cancelled'],
    ['dispatched', 'client_confirmed'], ['dispatched', 'uploading'], ['dispatched', 'published'], ['dispatched', 'failed'], ['dispatched', 'cancelled'],
    ['client_confirmed', 'uploading'], ['client_confirmed', 'publishing'], ['client_confirmed', 'published'], ['client_confirmed', 'failed'], ['client_confirmed', 'cancelled'],
    ['uploading', 'publishing'], ['uploading', 'published'], ['uploading', 'failed'], ['publishing', 'published'], ['publishing', 'failed'],
  ];
  const terminalStatuses = ['published', 'failed', 'cancelled'];
  const jobStatuses = ['pending', 'dispatched', 'client_confirmed', 'uploading', 'publishing', 'published', 'failed', 'cancelled'];
  const invalid: Array<[any, any]> = [
    ...terminalStatuses.flatMap((from) => jobStatuses.filter((to) => to !== from).map((to) => [from, to] as [any, any])),
    ['uploading', 'cancelled'], ['publishing', 'cancelled'], ['pending', 'publishing'], ['uploading', 'dispatched'], ['publishing', 'client_confirmed'],
  ];

  it('persists every allowed job transition and clears activeKey at terminal states', async () => {
    for (const [from, to] of allowed) {
      const job = await createJob(from);
      await prisma.$transaction((tx) => transitionJob(tx, job.id, from, to));
      const updated = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(updated.status, `${from} -> ${to}`).toBe(to);
      if (terminalStatuses.includes(to)) expect(updated.activeKey).toBeNull();
      else expect(updated.activeKey).toBe(`${job.contentId}:tiktok`);
    }
  });

  it('protects terminal and invalid job transitions with 409 and no new history', async () => {
    for (const [from, to] of invalid) {
      const job = await createJob(from);
      const historyBefore = await prisma.jobHistory.count({ where: { jobId: job.id } });
      await expect(prisma.$transaction((tx) => transitionJob(tx, job.id, from, to)), `${from} -> ${to}`)
        .rejects.toMatchObject({ status: 409, code: 'invalid_state_transition' });
      const unchanged = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(unchanged.status).toBe(from);
      expect(unchanged.activeKey).toBe(`${job.contentId}:tiktok`);
      expect(await prisma.jobHistory.count({ where: { jobId: job.id } })).toBe(historyBefore);
    }
  });
});

describe('Phase 1B task callback transaction rollback', () => {
  it('TikTok task callback is blocked with 409 since completion is accepted only from official TikTok status API', async () => {
    const content = await createContent('delivered');
    const token = issueToken({ tokenType: 'task', sub: 'placeholder', jobId: 'placeholder', deviceId: 'rollback-device', clientId, role: 'task' }, '24h');
    const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { jti: string; exp: number };
    const job = await prisma.publishJob.create({ data: {
      contentId: content.id, accountBindingId: bindingId, platform: 'tiktok', status: 'client_confirmed', activeKey: `${content.id}:tiktok`,
      taskTokenJti: decoded.jti, taskTokenExpiresAt: new Date(decoded.exp * 1000), taskDeviceId: 'rollback-device',
    } });
    const validToken = issueToken({ tokenType: 'task', sub: job.id, jobId: job.id, deviceId: 'rollback-device', clientId, role: 'task' }, '24h');
    const validDecoded = JSON.parse(Buffer.from(validToken.split('.')[1], 'base64url').toString('utf8')) as { jti: string; exp: number };
    await prisma.publishJob.update({ where: { id: job.id }, data: { taskTokenJti: validDecoded.jti, taskTokenExpiresAt: new Date(validDecoded.exp * 1000) } });
    const result = await request(app).post(`/v1/tasks/${job.id}/status`).set('Authorization', `Bearer ${validToken}`).send({ status: 'published' });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('official_tiktok_status_required');
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('client_confirmed');
  });
});
