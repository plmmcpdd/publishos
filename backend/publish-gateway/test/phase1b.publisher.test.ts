import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

vi.mock('dotenv/config', () => ({}));

const testDirectory = mkdtempSync(path.join(tmpdir(), 'publishos-phase1b-publisher-'));
const testDatabase = path.join(testDirectory, 'gateway.db');
const testDatabaseUrl = `file:${testDatabase}`;
const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = path.join(gatewayRoot, 'node_modules', '.bin', 'prisma');
const execFileAsync = promisify(execFile);
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.JWT_SECRET = 'phase1b-publisher-test-secret-that-is-at-least-32-bytes';
process.env.TIKTOK_CLIENT_KEY = 'test-client-key';
process.env.TIKTOK_CLIENT_SECRET = 'test-client-secret';
process.env.PUBLIC_SERVER_BASE = 'https://publisher-test.local';

let prisma: typeof import('../src/lib/prisma').prisma;
let publishToTikTok: typeof import('../src/services/publisher').publishToTikTok;
let app: ReturnType<typeof import('../src/app').createApp>;
let clientId = '';
let bindingId = '';
let adminToken = '';

async function pushTemporaryDatabase(): Promise<void> {
  closeSync(openSync(testDatabase, 'w'));
  await execFileAsync(prismaCli, ['db', 'push', '--config', './prisma.config.ts', '--schema', './prisma/schema.prisma'], {
    cwd: gatewayRoot,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    maxBuffer: 10 * 1024 * 1024,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function createJob(status: any, contentStatus: any = 'delivered') {
  const content = await prisma.content.create({ data: {
    clientId, title: `Publisher ${status} ${crypto.randomUUID()}`, description: 'publisher test', caption: 'caption',
    videoUrl: '/mock/video.mp4', platforms: '["tiktok"]', status: contentStatus,
  } });
  const job = await prisma.publishJob.create({ data: {
    contentId: content.id, accountBindingId: bindingId, platform: 'tiktok', status, activeKey: `${content.id}:tiktok`,
  } });
  return { content, job };
}

beforeAll(async () => {
  await pushTemporaryDatabase();
  ({ prisma } = await import('../src/lib/prisma'));
  ({ publishToTikTok } = await import('../src/services/publisher'));
  const { createApp } = await import('../src/app');
  app = createApp();
  const password = await bcrypt.hash('test-password', 4);
  const admin = await prisma.admin.create({ data: { name: 'Publisher Admin', email: 'publisher-admin@test.local', password } });
  const client = await prisma.client.create({ data: { name: 'Publisher Client', email: 'publisher@test.local', password: 'test-password' } });
  clientId = client.id;
  bindingId = (await prisma.accountBinding.create({ data: {
    clientId, platform: 'tiktok', accountUsername: 'publisher-account', accessToken: 'test-access-token',
  } })).id;
  adminToken = (await request(app).post('/v1/auth/admin/login').send({ email: admin.email, password: 'test-password' })).body.data.token;
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  rmSync(testDirectory, { recursive: true, force: true });
});

describe('Phase 1B server publisher', () => {
  it('publishes Legacy API content only after the real mocked publisher succeeds', async () => {
    const content = await prisma.content.create({ data: {
      clientId, title: 'Legacy actual publisher', description: 'publisher test', videoUrl: '/mock/legacy-api.mp4', platforms: '["tiktok"]', status: 'delivered',
    } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(Uint8Array.from([1, 2]), { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'ok' }, data: { publish_id: 'legacy-success', upload_url: 'https://upload.test.local/legacy' } }))
      .mockResolvedValueOnce(new Response('uploaded', { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'ok' }, data: { status: 'PUBLISH_COMPLETE' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app).post(`/api/v1/contents/${content.id}/publish`).set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.headers.deprecation).toBe('true');
    expect(response.body.data).toMatchObject({ publishing: true, idempotent: false, publishJobId: expect.any(String) });
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).status).toBe('delivered');
    await vi.advanceTimersByTimeAsync(10_000);

    const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: response.body.data.publishJobId } });
    expect(job).toMatchObject({ status: 'published', activeKey: null, publishId: 'legacy-success' });
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).status).toBe('published');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('completes upload, polling, and database publication without real network access', async () => {
    const { content, job } = await createJob('pending');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(Uint8Array.from([1, 2, 3]), { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'ok' }, data: { publish_id: 'publish-success', upload_url: 'https://upload.test.local/video' } }))
      .mockResolvedValueOnce(new Response('uploaded', { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'ok' }, data: { status: 'PUBLISH_COMPLETE' } }));
    vi.stubGlobal('fetch', fetchMock);

    const publishing = publishToTikTok(job.id);
    await vi.advanceTimersByTimeAsync(10_000);
    await publishing;

    const updatedJob = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });
    const updatedContent = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
    expect(updatedJob).toMatchObject({ status: 'published', activeKey: null, publishId: 'publish-success', platformPostId: 'publish-success', errorMessage: null, errorDetail: null, failedAt: null });
    expect(updatedJob.publishedAt).toBeInstanceOf(Date);
    expect(updatedContent).toMatchObject({ status: 'published' });
    expect(updatedContent.publishedAt).toBeInstanceOf(Date);
    expect((await prisma.jobHistory.findMany({ where: { jobId: job.id }, orderBy: { changedAt: 'asc' } })).map((item) => item.status)).toEqual(['uploading', 'publishing', 'published']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://publisher-test.local/mock/video.mp4');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/');
    expect(String(fetchMock.mock.calls[2][0])).toBe('https://upload.test.local/video');
    expect(String(fetchMock.mock.calls[3][0])).toBe('https://open.tiktokapis.com/v2/post/publish/status/fetch/');
  });

  it('records a download failure through the shared failed transition without publishing history', async () => {
    const { content, job } = await createJob('pending');
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await publishToTikTok(job.id);

    const updatedJob = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });
    const updatedContent = await prisma.content.findUniqueOrThrow({ where: { id: content.id } });
    expect(updatedJob).toMatchObject({ status: 'failed', activeKey: null, publishedAt: null });
    expect(updatedJob.failedAt).toBeInstanceOf(Date);
    expect(updatedJob.errorMessage).toContain('Failed to download video');
    expect(updatedJob.errorDetail).toContain('Failed to download video');
    expect(updatedContent.status).toBe('failed');
    const history = await prisma.jobHistory.findMany({ where: { jobId: job.id }, orderBy: { changedAt: 'asc' } });
    expect(history.map((item) => item.status)).toEqual(['uploading', 'failed']);
    expect(history.some((item) => item.status === 'published')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['published', 'published'], ['cancelled', 'delivered'], ['failed', 'failed'],
  ])('keeps a %s job terminal and performs no publisher fetch', async (jobStatus: any, contentStatus: any) => {
    const { content, job } = await createJob(jobStatus, contentStatus);
    const beforeHistory = await prisma.jobHistory.count({ where: { jobId: job.id } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await publishToTikTok(job.id);

    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(jobStatus);
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).status).toBe(contentStatus);
    expect(await prisma.jobHistory.count({ where: { jobId: job.id } })).toBe(beforeHistory);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not let a late publisher exception overwrite a completed publication', async () => {
    const { content, job } = await createJob('pending');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(Uint8Array.from([1]), { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'ok' }, data: { publish_id: 'late-error', upload_url: 'https://upload.test.local/late' } }))
      .mockResolvedValueOnce(new Response('uploaded', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'ok' }, data: { status: 'PUBLISH_COMPLETE' } }));
    vi.stubGlobal('fetch', fetchMock);
    const publishing = publishToTikTok(job.id);
    await vi.advanceTimersByTimeAsync(10_000);
    await publishing;
    const published = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });

    await publishToTikTok(job.id);

    const afterLateError = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(afterLateError).toMatchObject({ status: 'published', publishedAt: published.publishedAt, failedAt: null });
    expect((await prisma.content.findUniqueOrThrow({ where: { id: content.id } })).status).toBe('published');
    expect(await prisma.jobHistory.count({ where: { jobId: job.id, status: 'published' } })).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
