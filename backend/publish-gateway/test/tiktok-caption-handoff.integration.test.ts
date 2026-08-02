import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTemporaryPrismaDatabase } from './helpers/temporary-prisma';
import { composeTikTokCaption } from '../src/services/tiktok-content';

vi.mock('dotenv/config', () => ({}));
const publisher = vi.hoisted(() => ({ publishToTikTok: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/publisher', () => publisher);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = createTemporaryPrismaDatabase('publishos-caption-handoff', root);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'caption-handoff-test-secret-at-least-32-bytes';
process.env.DATABASE_URL = temporary.databaseUrl;

let app: ReturnType<typeof import('../src/app').createApp>;
let prisma: typeof import('../src/lib/prisma').prisma;
let clientToken = '';
let clientId = '';
let bindingId = '';

beforeAll(async () => {
  await temporary.migrate();
  ({ prisma } = await import('../src/lib/prisma'));
  const { createApp } = await import('../src/app');
  app = createApp();
  const password = await bcrypt.hash('test-password', 4);
  const client = await prisma.client.create({ data: { name: 'Caption client', email: 'caption-client@test.local', password } });
  clientId = client.id;
  bindingId = (await prisma.accountBinding.create({ data: {
    clientId, platform: 'tiktok', accountUsername: 'caption-account', username: 'caption-account',
    accessToken: 'safe-access-placeholder', refreshToken: 'safe-refresh-placeholder',
    grantedScopes: '["video.upload","video.list"]',
  } })).id;
  clientToken = (await request(app).post('/v1/auth/login').send({ email: client.email, password: 'test-password' })).body.data.token;
}, 60_000);

afterAll(async () => { try { await prisma?.$disconnect(); } finally { temporary.cleanup(); } });

describe('composeTikTokCaption', () => {
  it('combines a body and normalized hashtags with one blank line', () => {
    expect(composeTikTokCaption({ caption: 'Hello TikTok', hashtags: '["tag1", "#tag2", "tag1", " 中文 "]' }))
      .toEqual({ body: 'Hello TikTok', hashtags: ['#tag1', '#tag2', '#中文'], text: 'Hello TikTok\n\n#tag1 #tag2 #中文', hasContent: true });
  });

  it('supports caption-only, hashtags-only, empty, and nullable legacy data without using title', () => {
    expect(composeTikTokCaption({ caption: 'Only body', hashtags: null })).toMatchObject({ text: 'Only body', hasContent: true });
    expect(composeTikTokCaption({ caption: null, hashtags: 'tag1, #tag2 tag1' })).toMatchObject({ text: '#tag1 #tag2', hashtags: ['#tag1', '#tag2'] });
    expect(composeTikTokCaption({ caption: '  ', hashtags: undefined })).toEqual({ body: '', hashtags: [], text: '', hasContent: false });
    expect(composeTikTokCaption({ caption: null, hashtags: null, title: 'Internal title' } as never).text).toBe('');
  });

  it('does not duplicate hash marks, ignores empty or invalid tags, preserves first-seen order and preserves display case', () => {
    expect(composeTikTokCaption({ caption: '', hashtags: [' #One ', '##Two', '', 'one', 'bad-tag', '中文', 'Two'] }))
      .toMatchObject({ hashtags: ['#One', '#Two', '#中文'], text: '#One #Two #中文' });
  });
});

describe('caption handoff Content queue response', () => {
  it('returns safe, deterministic handoff fields and does not mutate Content or targeted routing', async () => {
    const content = await prisma.content.create({ data: {
      clientId, targetAccountBindingId: bindingId, title: 'Internal scheduling title', description: 'Legacy description',
      caption: 'Public caption', hashtags: '["one", "#Two", "one"]', videoUrl: 'mock/caption.mp4', platforms: '["tiktok"]', status: 'delivered',
    } });
    const before = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
    const result = await request(app).get(`/v1/content/delivered?clientId=${clientId}`).set('Authorization', `Bearer ${clientToken}`).expect(200);
    const item = result.body.data.find((candidate: { id: string }) => candidate.id === content.id);
    expect(item).toMatchObject({
      title: 'Internal scheduling title', caption: 'Public caption', hashtags: ['#one', '#Two'],
      tiktokCaptionText: 'Public caption\n\n#one #Two', tiktokCaptionHasContent: true,
      targetAccountBinding: { id: bindingId, accountUsername: 'caption-account' },
    });
    expect(item.tiktokCaptionText).not.toContain('Internal scheduling title');
    expect(JSON.stringify(item)).not.toContain('safe-access-placeholder');
    expect(JSON.stringify(item)).not.toContain('safe-refresh-placeholder');
    expect(JSON.stringify(item)).not.toContain('platformUserId');
    const after = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
    expect(after).toMatchObject({ id: before.id, caption: before.caption, hashtags: before.hashtags, targetAccountBindingId: bindingId });

    await request(app).post(`/v1/content/${content.id}/send-to-tiktok`).set('Authorization', `Bearer ${clientToken}`).send({ contentConfirmed: true }).expect(202);
    expect((await prisma.publishJob.findFirstOrThrow({ where: { contentId: content.id } })).accountBindingId).toBe(bindingId);
  });

  it('returns legacy null caption rows without breaking the queue', async () => {
    const legacy = await prisma.content.create({ data: {
      clientId, targetAccountBindingId: bindingId, title: 'Old content', description: 'Old description', caption: null,
      hashtags: '', videoUrl: 'mock/legacy.mp4', platforms: '["tiktok"]', status: 'delivered',
    } });
    const result = await request(app).get(`/v1/content/${legacy.id}?clientId=${clientId}`).set('Authorization', `Bearer ${clientToken}`).expect(200);
    expect(result.body.data).toMatchObject({ id: legacy.id, tiktokCaptionText: '', tiktokCaptionHasContent: false, hashtags: [] });
  });
});
