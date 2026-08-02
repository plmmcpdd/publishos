import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTemporaryPrismaDatabase } from './helpers/temporary-prisma';

vi.mock('dotenv/config', () => ({}));
const publisher = vi.hoisted(() => ({ publishToTikTok: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/publisher', () => publisher);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = createTemporaryPrismaDatabase('publishos-mobile-caption-handoff', root);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'mobile-caption-handoff-test-secret-at-least-32-bytes';
process.env.DATABASE_URL = temporary.databaseUrl;
process.env.PUBLIC_BASE_URL = 'https://handoff.example.test';

let app: ReturnType<typeof import('../src/app').createApp>;
let prisma: typeof import('../src/lib/prisma').prisma;
let clientAToken = '';
let clientBToken = '';
let clientAId = '';
let clientBId = '';
let bindingAId = '';
let validContentId = '';
let clientBContentId = '';
let draftContentId = '';
let emptyContentId = '';

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post('/v1/auth/login').send({ email, password }).expect(200);
  return response.body.data.token;
}

async function createLink(contentId = validContentId, token = clientAToken) {
  return request(app)
    .post(`/v1/content/${contentId}/mobile-caption-handoffs`)
    .set('Authorization', `Bearer ${token}`)
    .send({})
    .expect(201);
}

function rawToken(url: string): string {
  return new URL(url).hash.slice(1);
}

beforeAll(async () => {
  await temporary.migrate();
  ({ prisma } = await import('../src/lib/prisma'));
  const { createApp } = await import('../src/app');
  app = createApp();
  const password = await bcrypt.hash('test-password', 4);
  const clientA = await prisma.client.create({ data: { name: 'Client A', email: 'mobile-a@test.local', password } });
  const clientB = await prisma.client.create({ data: { name: 'Client B', email: 'mobile-b@test.local', password } });
  clientAId = clientA.id; clientBId = clientB.id;
  bindingAId = (await prisma.accountBinding.create({ data: {
    clientId: clientAId, platform: 'tiktok', accountUsername: 'safe-mobile-account', username: 'safe-mobile-account', platformUserId: 'provider-id-not-public',
  } })).id;
  const contentData = (clientId: string, suffix: string, status: 'delivered' | 'draft' = 'delivered') => ({
    clientId, title: `Mobile title ${suffix}`, description: `Description ${suffix}`, caption: `Caption ${suffix}`,
    hashtags: JSON.stringify(['one', '中文']), videoUrl: `fixture/${suffix}.mp4`, platforms: '["tiktok"]', status,
  });
  validContentId = (await prisma.content.create({ data: { ...contentData(clientAId, 'valid'), targetAccountBindingId: bindingAId } })).id;
  clientBContentId = (await prisma.content.create({ data: contentData(clientBId, 'other') })).id;
  draftContentId = (await prisma.content.create({ data: contentData(clientAId, 'draft', 'draft') })).id;
  emptyContentId = (await prisma.content.create({ data: {
    ...contentData(clientAId, 'empty'), caption: null, hashtags: '', targetAccountBindingId: bindingAId,
  } })).id;
  clientAToken = await login(clientA.email, 'test-password');
  clientBToken = await login(clientB.email, 'test-password');
}, 60_000);

beforeEach(async () => {
  publisher.publishToTikTok.mockClear();
  const { defaultRateLimitStore } = await import('../src/middleware/http-security');
  defaultRateLimitStore.clear();
});

afterAll(async () => { try { await prisma?.$disconnect(); } finally { temporary.cleanup(); } });

describe('Mobile Caption Handoff API', () => {
  it('requires Client authentication and applies no-store security headers to errors', async () => {
    const response = await request(app).post(`/v1/content/${validContentId}/mobile-caption-handoffs`).send({}).expect(401);
    expect(response.headers).toMatchObject({
      'cache-control': 'no-store', pragma: 'no-cache', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    });
  });

  it('rejects cross-tenant and non-Queue Content without leaking existence', async () => {
    const crossTenant = await request(app).post(`/v1/content/${clientBContentId}/mobile-caption-handoffs`).set('Authorization', `Bearer ${clientAToken}`).send({}).expect(404);
    const unknown = await request(app).post('/v1/content/not-a-content/mobile-caption-handoffs').set('Authorization', `Bearer ${clientAToken}`).send({}).expect(404);
    expect(crossTenant.body.error).toMatchObject({ code: unknown.body.error.code, message: unknown.body.error.message });
    await request(app).post(`/v1/content/${draftContentId}/mobile-caption-handoffs`).set('Authorization', `Bearer ${clientAToken}`).send({}).expect(404);
  });

  it('rejects Content without copyable caption text', async () => {
    await request(app).post(`/v1/content/${emptyContentId}/mobile-caption-handoffs`).set('Authorization', `Bearer ${clientAToken}`).send({}).expect(422);
  });

  it('creates only on click, uses a 256-bit fragment token and persists only its hash plus a safe snapshot', async () => {
    const before = await prisma.mobileCaptionHandoff.count({ where: { contentId: validContentId } });
    await request(app).get(`/v1/content/delivered?clientId=${clientAId}`).set('Authorization', `Bearer ${clientAToken}`).expect(200);
    expect(await prisma.mobileCaptionHandoff.count({ where: { contentId: validContentId } })).toBe(before);

    const response = await createLink();
    expect(Object.keys(response.body).sort()).toEqual(['expiresAt', 'handoffId', 'url']);
    const url = new URL(response.body.url);
    const token = rawToken(response.body.url);
    expect(url.protocol).toBe('https:'); expect(url.pathname).toBe('/h/'); expect(url.search).toBe('');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body.url).not.toContain(validContentId);
    expect(response.body.url).not.toContain(bindingAId);
    expect(response.body.url).not.toContain('Caption valid');
    const record = await prisma.mobileCaptionHandoff.findUniqueOrThrow({ where: { id: response.body.handoffId } });
    expect(record.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.tokenHash).not.toBe(token);
    expect(JSON.stringify(record)).not.toContain(token);
    expect(record).toMatchObject({
      contentId: validContentId, clientId: clientAId, titleSnapshot: 'Mobile title valid', targetAccountSnapshot: '@safe-mobile-account',
      captionSnapshot: 'Caption valid', hashtagsSnapshot: '["#one","#中文"]', captionTextSnapshot: 'Caption valid\n\n#one #中文',
    });
    expect(record.expiresAt.getTime() - record.createdAt.getTime()).toBeGreaterThanOrEqual(30 * 60_000 - 250);
    expect(record.expiresAt.getTime() - record.createdAt.getTime()).toBeLessThanOrEqual(30 * 60_000);
    expect(publisher.publishToTikTok).not.toHaveBeenCalled();
  });

  it('resolves immutable snapshots repeatedly after Content, hashtag, and account-display changes', async () => {
    const created = await createLink();
    const token = rawToken(created.body.url);
    await prisma.content.update({ where: { id: validContentId }, data: { title: 'Changed title', caption: 'Changed caption', hashtags: '["changed"]' } });
    await prisma.accountBinding.update({ where: { id: bindingAId }, data: { accountUsername: 'changed-account', username: 'changed-account' } });
    const first = await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token }).expect(200);
    const second = await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token }).expect(200);
    expect(first.body).toEqual(second.body);
    expect(first.body).toMatchObject({
      title: 'Mobile title valid', targetTikTokAccount: '@safe-mobile-account', caption: 'Caption valid',
      hashtags: ['#one', '#中文'], captionText: 'Caption valid\n\n#one #中文',
    });
    expect(Object.keys(first.body).sort()).toEqual(['caption', 'captionText', 'expiresAt', 'hashtags', 'targetTikTokAccount', 'title']);
    const serialized = JSON.stringify(first.body);
    for (const forbidden of ['contentId', 'clientId', 'accountBindingId', 'platformUserId', 'handoffId', 'videoUrl', 'tokenHash', 'accessToken', 'refreshToken']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(first.headers).toMatchObject({ 'cache-control': 'no-store', pragma: 'no-cache', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' });
  });

  it('transactionally revokes an active link when a replacement is generated', async () => {
    const oldLink = await createLink();
    const newLink = await createLink();
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(oldLink.body.url) }).expect(404);
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(newLink.body.url) }).expect(200);
    expect((await prisma.mobileCaptionHandoff.findUniqueOrThrow({ where: { id: oldLink.body.handoffId } })).revokedAt).not.toBeNull();
  });

  it('makes revoke tenant-safe, idempotent, and immediately effective', async () => {
    const created = await createLink();
    await request(app).delete(`/v1/mobile-caption-handoffs/${created.body.handoffId}`).set('Authorization', `Bearer ${clientBToken}`).expect(204);
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(created.body.url) }).expect(200);
    await request(app).delete(`/v1/mobile-caption-handoffs/${created.body.handoffId}`).set('Authorization', `Bearer ${clientAToken}`).expect(204);
    await request(app).delete(`/v1/mobile-caption-handoffs/${created.body.handoffId}`).set('Authorization', `Bearer ${clientAToken}`).expect(204);
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(created.body.url) }).expect(404);
  });

  it('expires only the link, leaves old Queue Content available, and permits a new link after delay or expiry', async () => {
    await prisma.content.update({ where: { id: validContentId }, data: {
      title: 'Mobile title valid', caption: 'Caption valid', hashtags: '["one","中文"]',
      createdAt: new Date(Date.now() - 60 * 60_000),
    } });
    const before = await prisma.mobileCaptionHandoff.count({ where: { contentId: validContentId } });
    const queue = await request(app).get(`/v1/content/delivered?clientId=${clientAId}`).set('Authorization', `Bearer ${clientAToken}`).expect(200);
    expect(queue.body.data.some((content: { id: string }) => content.id === validContentId)).toBe(true);
    expect(await prisma.mobileCaptionHandoff.count({ where: { contentId: validContentId } })).toBe(before);

    const expired = await createLink();
    await prisma.mobileCaptionHandoff.update({ where: { id: expired.body.handoffId }, data: { expiresAt: new Date(Date.now() - 1) } });
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(expired.body.url) }).expect(410);
    const afterExpiry = await request(app).get(`/v1/content/delivered?clientId=${clientAId}`).set('Authorization', `Bearer ${clientAToken}`).expect(200);
    expect(afterExpiry.body.data.some((content: { id: string }) => content.id === validContentId)).toBe(true);
    const replacement = await createLink();
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(replacement.body.url) }).expect(200);
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(expired.body.url) }).expect(410);
  });

  it('fails malformed tokens before database lookup and returns a generic response for unknown tokens', async () => {
    const lookup = { findUnique: vi.fn() };
    const { resolveMobileCaptionHandoff } = await import('../src/services/mobile-caption-handoff');
    await expect(resolveMobileCaptionHandoff('short', new Date(), lookup as never)).rejects.toMatchObject({ status: 404, code: 'handoff_not_found' });
    expect(lookup.findUnique).not.toHaveBeenCalled();
    const malformed = await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: 'short' }).expect(404);
    const unknown = await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: 'Z'.repeat(43) }).expect(404);
    expect(malformed.body.error).toMatchObject({ code: unknown.body.error.code, message: unknown.body.error.message });
  });

  it('fails closed when the snapshotted Content or Client is deleted', async () => {
    const password = await bcrypt.hash('test-password', 4);
    const disposableClient = await prisma.client.create({ data: {
      name: 'Disposable client', email: `disposable-${Date.now()}@test.local`, password,
    } });
    const disposableContent = await prisma.content.create({ data: {
      clientId: disposableClient.id, title: 'Disposable title', description: 'Description', caption: 'Disposable caption',
      hashtags: '[]', videoUrl: 'fixture/disposable.mp4', platforms: '["tiktok"]', status: 'delivered',
    } });
    const { createMobileCaptionHandoff } = await import('../src/services/mobile-caption-handoff');
    const first = await createMobileCaptionHandoff({ clientId: disposableClient.id, contentId: disposableContent.id });
    await prisma.content.delete({ where: { id: disposableContent.id } });
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(first.url) }).expect(404);

    const secondContent = await prisma.content.create({ data: {
      clientId: disposableClient.id, title: 'Second disposable title', description: 'Description', caption: 'Second caption',
      hashtags: '[]', videoUrl: 'fixture/disposable-2.mp4', platforms: '["tiktok"]', status: 'delivered',
    } });
    const second = await createMobileCaptionHandoff({ clientId: disposableClient.id, contentId: secondContent.id });
    await prisma.content.delete({ where: { id: secondContent.id } });
    await prisma.client.delete({ where: { id: disposableClient.id } });
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(second.url) }).expect(404);
  });

  it('does not place raw token or caption text in error logs', async () => {
    const unknownToken = 'Y'.repeat(43);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: unknownToken }).expect(404);
    const logged = error.mock.calls.flat().join(' ');
    expect(logged).not.toContain(unknownToken);
    expect(logged).not.toContain('Caption valid');
    error.mockRestore();
  });

  it('rate-limits the public resolver by trusted req.ip rather than arbitrary forwarded values', async () => {
    const { defaultRateLimitStore } = await import('../src/middleware/http-security');
    defaultRateLimitStore.clear();
    let finalStatus = 0;
    for (let index = 0; index < 31; index += 1) {
      const response = await request(app)
        .post('/v1/mobile-caption-handoffs/resolve')
        .set('X-Forwarded-For', `198.51.100.${index + 1}`)
        .send({ token: 'X'.repeat(43) });
      finalStatus = response.status;
    }
    expect(finalStatus).toBe(429);
  });

  it('does not affect Publisher or PublishJob account routing', async () => {
    const job = await prisma.publishJob.create({ data: {
      contentId: validContentId, accountBindingId: bindingAId, platform: 'tiktok', status: 'pending',
    } });
    const created = await createLink();
    await request(app).post('/v1/mobile-caption-handoffs/resolve').send({ token: rawToken(created.body.url) }).expect(200);
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).accountBindingId).toBe(bindingAId);
    expect(publisher.publishToTikTok).not.toHaveBeenCalled();
  });
});
