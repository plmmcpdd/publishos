import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { defaultRateLimitStore, InMemoryRateLimitStore } from '../src/middleware/http-security';
import { loadHttpSecurityConfig } from '../src/config/security';

const envKeys = [
  'CORS_ALLOWED_ORIGINS', 'CORS_ALLOW_NULL_ORIGIN', 'CORS_MAX_AGE_SECONDS', 'TRUST_PROXY_HOPS',
  'RATE_LIMIT_GENERAL_MAX', 'RATE_LIMIT_GENERAL_WINDOW_MS', 'RATE_LIMIT_LOGIN_MAX',
  'RATE_LIMIT_OAUTH_BROWSER_START_MAX', 'RATE_LIMIT_OAUTH_ELECTRON_EXCHANGE_MAX',
  'RATE_LIMIT_OAUTH_BROWSER_CALLBACK_MAX', 'RATE_LIMIT_UPLOAD_MAX', 'RATE_LIMIT_TICKET_MAX',
] as const;
const saved = new Map<string, string | undefined>();
let createApp: typeof import('../src/app').createApp;

function token(subject: string): string {
  return jwt.sign({ sub: subject, tokenType: 'client', role: 'client', clientId: subject }, process.env.JWT_SECRET!, { algorithm: 'HS256', issuer: 'publishos', audience: 'publishos-api', expiresIn: '1h', jwtid: `test-${subject}` });
}

function adminToken(subject = 'admin-a'): string {
  return jwt.sign({ sub: subject, tokenType: 'admin', role: 'admin' }, process.env.JWT_SECRET!, { algorithm: 'HS256', issuer: 'publishos', audience: 'publishos-api', expiresIn: '1h', jwtid: `test-${subject}` });
}

beforeEach(async () => {
  for (const key of envKeys) { saved.set(key, process.env[key]); delete process.env[key]; }
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'phase1c-http-security-test-secret-at-least-32-bytes';
  process.env.DATABASE_URL = 'file:/tmp/publishos-phase1c-http-security-unused.db';
  process.env.CORS_ALLOWED_ORIGINS = 'https://trusted.example,http://trusted.example:8080';
  defaultRateLimitStore.clear();
  ({ createApp } = await import('../src/app'));
});

afterEach(() => {
  defaultRateLimitStore.clear();
  for (const key of envKeys) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe('Phase 1C CORS, trusted proxy, and endpoint rate-limit integration', () => {
  it('allows only canonical configured origins and returns one safe CORS error shape', async () => {
    const app = createApp();
    for (const origin of ['https://trusted.example', 'HTTPS://TRUSTED.EXAMPLE', 'http://trusted.example:8080']) {
      const response = await request(app).get('/health').set('Origin', origin);
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers.vary).toContain('Origin');
    }
    for (const origin of ['https://trusted.example.attacker.test', 'https://attackertrusted.example', 'https://trusted.example@evil.test', 'http://trusted.example', 'https://trusted.example:444', 'https://trusted.example/path', 'not a URL', 'https://trusted.example,https://evil.test']) {
      const response = await request(app).get('/health').set('Origin', origin).set('X-Request-Id', 'cors-request-id');
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: { code: 'cors_origin_denied', message: 'Origin is not allowed', requestId: 'cors-request-id' } });
      expect(response.headers['x-request-id']).toBe('cors-request-id');
      expect(JSON.stringify(response.body)).not.toContain('trusted.example,http');
    }
  });

  it('keeps no-origin distinct from null and only permits null when explicitly configured', async () => {
    const app = createApp();
    const native = await request(app).get('/health');
    expect(native.status).toBe(200);
    expect(native.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(app).get('/health').set('Origin', 'null')).status).toBe(403);
    process.env.CORS_ALLOW_NULL_ORIGIN = 'true';
    const allowed = await request(app).get('/health').set('Origin', 'null');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('null');
  });

  it('handles allowed preflight before routing and refuses an untrusted preflight', async () => {
    const app = createApp();
    const allowed = await request(app).options('/v1/not-a-route')
      .set('Origin', 'https://trusted.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type');
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://trusted.example');
    expect(allowed.headers['access-control-allow-methods']).toContain('POST');
    expect(allowed.headers['access-control-allow-headers']).toContain('Authorization');
    expect(allowed.headers['access-control-max-age']).toBe('600');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    expect((await request(app).options('/v1/not-a-route').set('Origin', 'https://evil.test')).status).toBe(403);
  });

  it('fails closed for malformed production origin configuration and normalizes safe configuration', () => {
    expect(() => loadHttpSecurityConfig({ NODE_ENV: 'production' })).toThrow('CORS_ALLOWED_ORIGINS');
    expect(() => loadHttpSecurityConfig({ CORS_ALLOWED_ORIGINS: '*,https://trusted.example' })).toThrow();
    expect(() => loadHttpSecurityConfig({ CORS_ALLOWED_ORIGINS: 'https://trusted.example/path' })).toThrow();
    expect(loadHttpSecurityConfig({ CORS_ALLOWED_ORIGINS: ' HTTPS://TRUSTED.EXAMPLE , https://trusted.example ' }).allowedOrigins).toEqual(['https://trusted.example']);
  });

  it('does not trust forged forwarding headers by default, but honors exactly one configured proxy hop', async () => {
    process.env.RATE_LIMIT_GENERAL_MAX = '1';
    let app = createApp();
    expect((await request(app).get('/v1/not-a-route').set('X-Forwarded-For', '198.51.100.1')).status).toBe(401);
    const blocked = await request(app).get('/v1/not-a-route').set('X-Forwarded-For', '203.0.113.9, 198.51.100.2').set('X-Real-IP', '192.0.2.77').set('Forwarded', 'for=203.0.113.8');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.requestId).toEqual(expect.any(String));
    expect(blocked.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    defaultRateLimitStore.clear();
    process.env.TRUST_PROXY_HOPS = '1';
    app = createApp();
    expect((await request(app).get('/v1/not-a-route').set('X-Forwarded-For', '198.51.100.1')).status).toBe(401);
    expect((await request(app).get('/v1/not-a-route').set('X-Forwarded-For', '203.0.113.9')).status).toBe(401);
  });

  it('parses only bounded, non-negative trusted-proxy configuration', () => {
    expect(loadHttpSecurityConfig({ TRUST_PROXY_HOPS: '0' }).trustProxyHops).toBe(0);
    expect(loadHttpSecurityConfig({ TRUST_PROXY_HOPS: ' 1 ' }).trustProxyHops).toBe(1);
    for (const value of ['-1', '1.5', 'NaN', 'Infinity', 'eleven', '11']) expect(() => loadHttpSecurityConfig({ TRUST_PROXY_HOPS: value })).toThrow();
  });

  it('enforces a general endpoint limit atomically while exempting health and OPTIONS', async () => {
    process.env.RATE_LIMIT_GENERAL_MAX = '2';
    const app = createApp();
    expect((await request(app).get('/health')).status).toBe(200);
    const responses = await Promise.all(Array.from({ length: 5 }, () => request(app).get('/v1/not-a-route')));
    expect(responses.filter((response) => response.status === 401)).toHaveLength(2);
    const denied = responses.filter((response) => response.status === 429);
    expect(denied).toHaveLength(3);
    for (const response of denied) {
      expect(response.body.error).toMatchObject({ code: 'rate_limit_exceeded', requestId: expect.any(String) });
      expect(response.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    }
    expect((await request(app).options('/v1/not-a-route').set('Origin', 'https://trusted.example')).status).toBe(204);
  });

  it('segments login and OAuth actor buckets without using bearer values as keys', async () => {
    process.env.RATE_LIMIT_LOGIN_MAX = '1';
    process.env.RATE_LIMIT_OAUTH_BROWSER_START_MAX = '1';
    const app = createApp();
    await request(app).post('/v1/auth/login').send({ email: 'a@test', password: 'not-logged' });
    expect((await request(app).post('/v1/auth/login').send({ email: 'b@test', password: 'not-logged' })).status).toBe(429);
    const a = token('client-a'); const b = token('client-b');
    await request(app).get('/v1/tiktok/auth').set('Authorization', `Bearer ${a}`).query({ clientId: 'client-a' });
    expect((await request(app).get('/v1/tiktok/auth').set('Authorization', `Bearer ${a}`).query({ clientId: 'client-a' })).status).toBe(429);
    expect((await request(app).get('/v1/tiktok/auth').set('Authorization', `Bearer ${b}`).query({ clientId: 'client-b' })).status).not.toBe(429);
  });

  it('limits OAuth exchange/callback, upload, and ticket endpoints before costly work', async () => {
    process.env.RATE_LIMIT_OAUTH_ELECTRON_EXCHANGE_MAX = '1';
    process.env.RATE_LIMIT_OAUTH_BROWSER_CALLBACK_MAX = '1';
    process.env.RATE_LIMIT_UPLOAD_MAX = '1';
    process.env.RATE_LIMIT_TICKET_MAX = '1';
    const app = createApp(); const client = token('client-a'); const admin = adminToken();
    expect((await request(app).post('/v1/tiktok/exchange').set('Authorization', `Bearer ${client}`).send({})).status).not.toBe(429);
    expect((await request(app).post('/v1/tiktok/exchange').set('Authorization', `Bearer ${client}`).send({ code: 'secret-code', state: 'secret-state' })).status).toBe(429);
    expect((await request(app).get('/v1/tiktok/callback')).status).not.toBe(429);
    expect((await request(app).get('/v1/tiktok/callback').query({ code: 'secret-code', state: 'secret-state' })).status).toBe(429);
    expect((await request(app).post('/v1/upload/video').set('Authorization', `Bearer ${admin}`)).status).not.toBe(429);
    expect((await request(app).post('/v1/upload/video').set('Authorization', `Bearer ${admin}`)).status).toBe(429);
    await request(app).get('/v1/tickets').set('Authorization', `Bearer ${admin}`);
    const ticketDenied = await request(app).get('/v1/tickets').set('Authorization', `Bearer ${admin}`);
    expect(ticketDenied.status).toBe(429);
    expect(ticketDenied.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    expect(JSON.stringify(ticketDenied.body)).not.toContain('secret-state');
  });

  it('expires and bounds isolated limiter stores without retaining request objects', () => {
    const store = new InMemoryRateLimitStore(2);
    expect(store.check('a', 1, 10, 0).allowed).toBe(true);
    expect(store.check('b', 1, 10, 0).allowed).toBe(true);
    expect(store.check('c', 1, 10, 0).allowed).toBe(false);
    expect(store.size).toBe(2);
    expect(store.check('c', 1, 10, 11).allowed).toBe(true);
    expect(store.size).toBe(1);
    store.clear();
    expect(store.size).toBe(0);
  });
});
