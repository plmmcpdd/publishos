import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTemporaryPrismaDatabase } from './helpers/temporary-prisma';

vi.mock('dotenv/config', () => ({}));
const publisher = vi.hoisted(() => ({ publishToTikTok: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/publisher', () => publisher);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = createTemporaryPrismaDatabase('publishos-account-targeting', root);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'account-targeting-test-secret-at-least-32-bytes';
process.env.DATABASE_URL = temporary.databaseUrl;

let app: ReturnType<typeof import('../src/app').createApp>;
let prisma: typeof import('../src/lib/prisma').prisma;
let adminToken = '';
let clientToken = '';
let clientId = '';
let otherClientId = '';
let firstBinding = '';
let secondBinding = '';
let otherBinding = '';

const placeholders = { accessToken: 'test-access-placeholder', refreshToken: 'test-refresh-placeholder' };
const tikTokData = (overrides: Record<string, unknown> = {}) => ({
  platform: 'tiktok', accountUsername: 'target-one', username: 'target-one', active: true, status: 'active',
  accessToken: placeholders.accessToken, refreshToken: placeholders.refreshToken,
  grantedScopes: '["video.upload","video.list"]', ...overrides,
});

async function createContent(overrides: Record<string, unknown> = {}) {
  return prisma.content.create({ data: {
    clientId, targetAccountBindingId: firstBinding, title: 'Targeted content', description: 'test', videoUrl: 'mock/video.mp4',
    platforms: '["tiktok"]', status: 'approved', ...overrides,
  } });
}

async function deliverAndSend(contentId: string, body: Record<string, unknown> = {}) {
  await request(app).post(`/v1/content/${contentId}/deliver`).set('Authorization', `Bearer ${adminToken}`).expect(200);
  return request(app).post(`/v1/content/${contentId}/send-to-tiktok`).set('Authorization', `Bearer ${clientToken}`)
    .send({ contentConfirmed: true, ...body });
}

beforeAll(async () => {
  await temporary.migrate();
  const check = new Database(temporary.database, { readonly: true });
  try {
    check.pragma('foreign_keys = ON');
    expect(check.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { check.close(); }
  ({ prisma } = await import('../src/lib/prisma'));
  const { createApp } = await import('../src/app');
  app = createApp();
  const password = await bcrypt.hash('test-password', 4);
  const [admin, client, other] = await Promise.all([
    prisma.admin.create({ data: { name: 'Admin', email: 'target-admin@test.local', password } }),
    prisma.client.create({ data: { name: 'Target client', email: 'target-client@test.local', password } }),
    prisma.client.create({ data: { name: 'Other client', email: 'other-client@test.local', password } }),
  ]);
  clientId = client.id; otherClientId = other.id;
  firstBinding = (await prisma.accountBinding.create({ data: { clientId, ...tikTokData() } })).id;
  secondBinding = (await prisma.accountBinding.create({ data: { clientId, ...tikTokData({ accountUsername: 'target-two', username: 'target-two', accessToken: 'test-access-placeholder-two' }) } })).id;
  otherBinding = (await prisma.accountBinding.create({ data: { clientId: otherClientId, ...tikTokData({ accountUsername: 'other-target' }) } })).id;
  adminToken = (await request(app).post('/v1/auth/admin/login').send({ email: admin.email, password: 'test-password' })).body.data.token;
  clientToken = (await request(app).post('/v1/auth/login').send({ email: client.email, password: 'test-password' })).body.data.token;
}, 60_000);

afterAll(async () => { try { await prisma?.$disconnect(); } finally { temporary.cleanup(); } });

describe('account-targeted Content delivery', () => {
  it('keeps two active TikTok accounts distinct and preserves a selected target', async () => {
    expect(firstBinding).not.toBe(secondBinding);
    const content = await createContent({ targetAccountBindingId: secondBinding });
    expect(content.targetAccountBindingId).toBe(secondBinding);
    await prisma.accountBinding.update({ where: { id: firstBinding }, data: { accountUsername: 'target-one-renamed' } });
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).targetAccountBindingId).toBe(secondBinding);
  });

  it('requires a valid owned TikTok target when creating TikTok content, but not non-TikTok content', async () => {
    const base = { clientId, title: 'Create target', description: 'test', videoUrl: 'mock/video.mp4', platforms: ['tiktok'] };
    await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken}`).send(base).expect(422);
    await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken}`).send({ ...base, targetAccountBindingId: 'missing' }).expect(404);
    await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken}`).send({ ...base, targetAccountBindingId: otherBinding }).expect(409);
    const nonTikTok = await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken}`).send({ ...base, platforms: ['instagram'] }).expect(201);
    expect(nonTikTok.body.data.targetAccountBinding).toBeNull();
  });

  it.each([
    ['inactive', { active: false }], ['revoked', { status: 'revoked' }], ['reauthorizationRequired', { reauthorizationRequired: true }], ['missing video.upload', { grantedScopes: '["video.list"]' }],
  ])('rejects a %s target at create and deliver', async (_name, data) => {
    const binding = await prisma.accountBinding.create({ data: { clientId, ...tikTokData({ accountUsername: `invalid-${_name}`, ...data }) } });
    const created = await request(app).post('/v1/content').set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, targetAccountBindingId: binding.id, title: 'Invalid target', description: 'test', videoUrl: 'mock/video.mp4', platforms: ['tiktok'] });
    expect(created.status).toBe(409);
    const content = await createContent({ targetAccountBindingId: binding.id });
    await expect(request(app).post(`/v1/content/${content.id}/deliver`).set('Authorization', `Bearer ${adminToken}`)).resolves.toMatchObject({ status: 409 });
  });

  it('enforces the draft and review state machine before delivery', async () => {
    const draft = await createContent({ status: 'draft' });
    const pending = await createContent({ status: 'pending_review' });
    expect((await request(app).post(`/v1/content/${draft.id}/deliver`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(409);
    expect((await request(app).post(`/v1/content/${pending.id}/deliver`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(409);
  });

  it('sends only the Content target, rejects body override, and creates an exactly-targeted job', async () => {
    const content = await createContent({ targetAccountBindingId: secondBinding });
    await request(app).post(`/v1/content/${content.id}/deliver`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const mismatch = await request(app).post(`/v1/content/${content.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientToken}`)
      .send({ contentConfirmed: true, accountBindingId: firstBinding });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('target_account_mismatch');
    const sent = await request(app).post(`/v1/content/${content.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientToken}`).send({ contentConfirmed: true });
    expect(sent.status).toBe(202);
    const job = await prisma.publishJob.findFirstOrThrow({ where: { contentId: content.id } });
    expect(job.accountBindingId).toBe(secondBinding);
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).targetAccountBindingId).toBe(secondBinding);
    expect(publisher.publishToTikTok).toHaveBeenCalledWith(job.id);
  });

  it('blocks legacy null targets and never reroutes after a target is disconnected or needs reconnection', async () => {
    const legacy = await prisma.content.create({ data: { clientId, title: 'Legacy', description: 'test', videoUrl: 'mock/video.mp4', platforms: '["tiktok"]', status: 'delivered' } });
    expect((await request(app).post(`/v1/content/${legacy.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientToken}`).send({ contentConfirmed: true })).status).toBe(422);
    const content = await createContent({ targetAccountBindingId: firstBinding });
    await prisma.accountBinding.update({ where: { id: firstBinding }, data: { active: false, status: 'revoked' } });
    await request(app).post(`/v1/content/${content.id}/deliver`).set('Authorization', `Bearer ${adminToken}`).expect(409);
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).targetAccountBindingId).toBe(firstBinding);
  });

  it('keeps independent content routed to each account and repeated send is idempotent', async () => {
    await prisma.accountBinding.update({ where: { id: firstBinding }, data: { active: true, status: 'active', reauthorizationRequired: false, grantedScopes: '["video.upload","video.list"]' } });
    const one = await createContent({ targetAccountBindingId: firstBinding });
    const two = await createContent({ targetAccountBindingId: secondBinding });
    expect((await deliverAndSend(one.id)).status).toBe(202);
    expect((await deliverAndSend(two.id)).status).toBe(202);
    const repeat = await request(app).post(`/v1/content/${one.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientToken}`).send({ contentConfirmed: true }).expect(200);
    expect(repeat.body.data.idempotent).toBe(true);
    const jobs = await prisma.publishJob.findMany({ where: { contentId: { in: [one.id, two.id] } }, orderBy: { contentId: 'asc' } });
    expect(jobs.map((job) => job.accountBindingId).sort()).toEqual([firstBinding, secondBinding].sort());
  });

  it('returns only safe target summaries and records target audit context without tokens', async () => {
    const content = await createContent({ targetAccountBindingId: secondBinding });
    expect((await deliverAndSend(content.id)).status).toBe(202);
    const response = await request(app).get(`/v1/content/${content.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(response.body.data.targetAccountBinding).toMatchObject({ id: secondBinding, accountUsername: 'target-two' });
    expect(JSON.stringify(response.body)).not.toContain(placeholders.accessToken);
    expect(JSON.stringify(response.body)).not.toContain(placeholders.refreshToken);
    expect(JSON.stringify(response.body)).not.toContain('platformUserId');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'tiktok_send_requested' }, orderBy: { createdAt: 'desc' } });
    expect(audit.details).toContain(content.id); expect(audit.details).toContain(clientId); expect(audit.details).toContain(secondBinding); expect(audit.details).toContain('target-two');
    expect(audit.details).not.toContain(placeholders.accessToken); expect(audit.details).not.toContain(placeholders.refreshToken);
  });
});
