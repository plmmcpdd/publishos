import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import mediaRoutes from '../src/routes/media';
import { errorHandler, requestId } from '../src/middleware/errors';
import { signedMediaUrl } from '../src/services/media-signing';

const directory = mkdtempSync(path.join(tmpdir(), 'publishos-phase1c-media-'));
let app: express.Express;
let url = '';
beforeAll(() => {
  process.env.NODE_ENV = 'test'; process.env.MEDIA_ROOT = directory; process.env.PUBLIC_BASE_URL = 'http://media.test'; process.env.MEDIA_SIGNING_SECRET = 'media-test-secret-that-is-at-least-32-bytes';
  fs.mkdirSync(path.join(directory, 'videos')); writeFileSync(path.join(directory, 'videos', 'fixture.mp4'), Buffer.from('fixture-media'));
  app = express(); app.use(requestId); app.use('/v1', mediaRoutes); app.use(errorHandler);
  url = new URL(signedMediaUrl('local:videos/fixture.mp4').url).pathname + new URL(signedMediaUrl('local:videos/fixture.mp4').url).search;
});
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });
describe('Phase 1C signed media HTTP boundary', () => {
  it('rejects missing and tampered signatures', async () => {
    expect((await request(app).get('/v1/media')).status).toBe(401);
    const parsed = new URL(`http://media.test${url}`); parsed.searchParams.set('sig', 'tampered');
    expect((await request(app).get(`${parsed.pathname}${parsed.search}`)).status).toBe(401);
  });
  it('streams a valid URL with nosniff and range semantics', async () => {
    const valid = await request(app).get(url); expect(valid.status).toBe(200); expect(valid.headers['x-content-type-options']).toBe('nosniff');
    const partial = await request(app).get(url).set('Range', 'bytes=0-2'); expect(partial.status).toBe(206); expect(Buffer.from(partial.body).toString()).toBe('fix');
    expect((await request(app).get(url).set('Range', 'bytes=999-1000')).status).toBe(416);
  });
  it('rejects encoded traversal before touching disk', async () => {
    const parsed = new URL(`http://media.test${url}`); parsed.searchParams.set('key', 'local:%2e%2e/secret');
    expect((await request(app).get(`${parsed.pathname}${parsed.search}`)).status).toBe(401);
  });
});
