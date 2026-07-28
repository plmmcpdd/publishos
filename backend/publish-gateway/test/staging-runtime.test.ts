import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';

const directory = mkdtempSync(path.join(tmpdir(), 'publishos-staging-runtime-'));
const database = path.join(directory, 'staging.db');
const bridgeToken = 'test-only-bridge-token-that-is-longer-than-thirty-two-bytes';

process.env.APP_ENV = 'staging';
process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = `file:${database}`;
process.env.JWT_SECRET = 'staging-runtime-test-jwt-secret-at-least-32-bytes';
process.env.MEDIA_SIGNING_SECRET = 'staging-runtime-test-media-secret-at-least-32-bytes';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3300';
process.env.CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:3300';
process.env.OPS_BRAIN_BRIDGE_ENABLED = 'true';
process.env.OPS_BRAIN_BRIDGE_TOKEN = bridgeToken;
process.env.TIKTOK_INTEGRATION_ENABLED = 'false';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.HOST = '127.0.0.1';
process.env.PORT = '3300';

let createApp: typeof import('../src/app').createApp;
let loadRuntimeConfig: typeof import('../src/config/security').loadRuntimeConfig;
let validateRuntimeConfig: typeof import('../src/config/security').validateRuntimeConfig;
let startServer: typeof import('../src/server').startServer;
let prisma: typeof import('../src/lib/prisma').prisma;

function stagingEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: 'staging',
    NODE_ENV: 'production',
    DATABASE_URL: `file:${database}`,
    JWT_SECRET: 'staging-runtime-test-jwt-secret-at-least-32-bytes',
    MEDIA_SIGNING_SECRET: 'staging-runtime-test-media-secret-at-least-32-bytes',
    PUBLIC_BASE_URL: 'http://127.0.0.1:3300',
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:3300',
    OPS_BRAIN_BRIDGE_ENABLED: 'true',
    OPS_BRAIN_BRIDGE_TOKEN: bridgeToken,
    TIKTOK_INTEGRATION_ENABLED: 'false',
    BACKGROUND_JOBS_ENABLED: 'false',
    HOST: '127.0.0.1',
    PORT: '3300',
    ...overrides,
  };
}

beforeAll(async () => {
  closeSync(openSync(database, 'w'));
  const root = path.resolve(import.meta.dirname, '..');
  execFileSync(path.join(root, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--config', './prisma.config.ts'], { cwd: root, env: process.env });
  ({ createApp } = await import('../src/app'));
  ({ loadRuntimeConfig, validateRuntimeConfig } = await import('../src/config/security'));
  ({ startServer } = await import('../src/server'));
  ({ prisma } = await import('../src/lib/prisma'));
});

beforeEach(() => {
  Object.assign(process.env, stagingEnv());
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_SECRET;
  delete process.env.TIKTOK_REDIRECT_URI;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

describe('safe staging runtime', () => {
  it('uses explicit loopback defaults and retains production defaults only in production mode', () => {
    expect(loadRuntimeConfig(stagingEnv({ HOST: undefined, PORT: undefined }))).toMatchObject({
      appEnv: 'staging', host: '127.0.0.1', port: 3300,
      tiktokIntegrationEnabled: false, backgroundJobsEnabled: false,
      metricsCronEnabled: false, reconciliationCronEnabled: false, startupReconciliationEnabled: false,
    });
    expect(loadRuntimeConfig({ APP_ENV: 'production' })).toMatchObject({
      host: '0.0.0.0', port: 3000, tiktokIntegrationEnabled: true, backgroundJobsEnabled: true,
    });
  });

  it('starts staging without TikTok credentials, binds the requested loopback address, and schedules no work', async () => {
    const logs = vi.fn();
    const errors = vi.fn();
    const schedule = vi.fn();
    const collectAllMetrics = vi.fn(async () => {});
    const reconcileTikTokJobs = vi.fn(async () => ({ selected: 0, fulfilled: 0, rejected: 0 }));
    const server = { close: (callback: () => void) => callback() } as unknown as Server;
    const listen = vi.fn((_port: number, _host: string, callback: () => void) => { callback(); return server; });

    const running = startServer({
      env: stagingEnv(),
      installSignalHandlers: false,
      dependencies: {
        createApp: () => ({ listen }), schedule, collectAllMetrics, reconcileTikTokJobs,
        disconnectDatabase: async () => {}, log: logs, error: errors,
      },
    });

    expect(running.runtime).toMatchObject({ host: '127.0.0.1', port: 3300, tiktokIntegrationEnabled: false });
    expect(listen).toHaveBeenCalledWith(3300, '127.0.0.1', expect.any(Function));
    expect(schedule).not.toHaveBeenCalled();
    expect(collectAllMetrics).not.toHaveBeenCalled();
    expect(reconcileTikTokJobs).not.toHaveBeenCalled();
    const output = JSON.stringify([...logs.mock.calls, ...errors.mock.calls]);
    expect(output).toContain('metrics_cron_disabled');
    expect(output).toContain('tiktok_reconciliation_cron_disabled');
    expect(output).toContain('tiktok_startup_reconciliation_disabled');
    expect(output).not.toContain(bridgeToken);
    await running.shutdown('test');
  });

  it('keeps health, ready, and the enabled bridge route available', async () => {
    const app = createApp();
    await request(app).get('/health').expect(200).expect({ status: 'ok', version: '1.0.0' });
    await request(app).get('/ready').expect(200).expect({ status: 'ready', database: true, version: '1.0.0' });
    await request(app).get('/v1/integrations/ops-brain/performance').expect(401);
  });

  it('requires a bridge token only when the bridge is enabled and validates every fail-closed switch', () => {
    const bridgeDisabled = stagingEnv({ OPS_BRAIN_BRIDGE_ENABLED: 'false', OPS_BRAIN_BRIDGE_TOKEN: undefined });
    expect(validateRuntimeConfig(bridgeDisabled)).toMatchObject({ appEnv: 'staging' });
    expect(() => validateRuntimeConfig(stagingEnv({ OPS_BRAIN_BRIDGE_TOKEN: 'short' }))).toThrow('OPS_BRAIN_BRIDGE_TOKEN');
    expect(() => validateRuntimeConfig(stagingEnv({ TIKTOK_INTEGRATION_ENABLED: 'true' }))).toThrow('TIKTOK_CLIENT_KEY');
    expect(() => validateRuntimeConfig(stagingEnv({ HOST: 'localhost' }))).toThrow('HOST');
    expect(() => validateRuntimeConfig(stagingEnv({ HOST: '0.0.0.0' }))).toThrow('loopback');
    expect(() => validateRuntimeConfig(stagingEnv({ PORT: '0' }))).toThrow('PORT');
    expect(() => validateRuntimeConfig(stagingEnv({ PORT: '3300.5' }))).toThrow('PORT');
  });
});
