import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureHarnessDatabase } from './database';
import { loadFixture } from './fixture';
import { seedHarness } from './seed';

interface Options {
  host: string;
  port: number;
  portFile: string;
  database: string;
  seed: string;
  bridgeEnabled: boolean;
}

function log(event: string, details: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ level: 'info', event, ...details })}\n`);
}

function fail(message: string): never {
  throw new Error(`TEST_ENVIRONMENT: ${message}`);
}

function argument(name: string, values: string[]): string {
  const index = values.indexOf(name);
  if (index < 0 || !values[index + 1]) fail(`${name} is required`);
  return values[index + 1];
}

function options(argv: string[]): Options {
  const values = argv.slice(2);
  const host = argument('--host', values);
  const portText = argument('--port', values);
  const port = Number(portText);
  if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 0 || port > 65535) fail('host must be 127.0.0.1 and port must be 0..65535');
  const bridgeEnabled = values.includes('--bridge-disabled') ? false : true;
  return {
    host,
    port,
    portFile: path.resolve(argument('--port-file', values)),
    database: path.resolve(argument('--database', values)),
    seed: path.resolve(argument('--seed', values)),
    bridgeEnabled,
  };
}

function installExternalNetworkGuard(): void {
  const deny = (kind: string): never => {
    process.stderr.write(`${JSON.stringify({ level: 'error', event: 'external_network_attempt', kind })}\n`);
    throw new Error(`external network is forbidden in the harness: ${kind}`);
  };
  globalThis.fetch = (async () => deny('fetch')) as typeof fetch;
  const originalRequest = http.request;
  http.request = ((...args: Parameters<typeof http.request>) => {
    const first = args[0];
    const host = typeof first === 'string' ? new URL(first).hostname : first instanceof URL ? first.hostname : first?.hostname;
    if (host && host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') return deny('http.request');
    return originalRequest(...args);
  }) as typeof http.request;
}

function migrate(repositoryRoot: string, database: string): void {
  const prisma = path.join(repositoryRoot, 'node_modules', '.bin', 'prisma');
  if (!existsSync(prisma)) fail('Prisma CLI is not installed');
  const result = spawnSync(prisma, ['migrate', 'deploy', '--config', './prisma.config.ts'], {
    cwd: repositoryRoot,
    env: { ...process.env, DATABASE_URL: `file:${database}`, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  if (result.status !== 0) fail(`migration failed: ${(result.stderr || result.stdout || '').trim().slice(0, 300)}`);
}

async function atomicPortFile(target: string, port: number): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${port}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function main(): Promise<void> {
  const config = options(process.argv);
  const repositoryRoot = process.env.HARNESS_REPO_ROOT;
  if (!repositoryRoot || !path.isAbsolute(repositoryRoot)) fail('HARNESS_REPO_ROOT must be an absolute path');
  const token = process.env.OPS_BRAIN_BRIDGE_TOKEN || '';
  if (config.bridgeEnabled && Buffer.byteLength(token, 'utf8') < 32) fail('test bridge token must be at least 32 bytes');
  if (!existsSync(config.seed)) fail('seed fixture does not exist');
  await rm(config.database, { force: true });
  await ensureHarnessDatabase(config.database);

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `file:${config.database}`;
  process.env.JWT_SECRET = 'harness-jwt-secret-at-least-32-bytes';
  process.env.MEDIA_SIGNING_SECRET = 'harness-media-secret-at-least-32-bytes';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1';
  process.env.OPS_BRAIN_BRIDGE_ENABLED = config.bridgeEnabled ? 'true' : 'false';
  if (!config.bridgeEnabled) delete process.env.OPS_BRAIN_BRIDGE_TOKEN;

  installExternalNetworkGuard();
  migrate(repositoryRoot, config.database);
  const fixture = await loadFixture(config.seed);
  await seedHarness(fixture, `${config.database}.seed-manifest.json`);
  const { createApp } = await import('../../../src/app');
  const { prisma } = await import('../../../src/lib/prisma');
  const app = createApp();
  const server = app.listen(config.port, config.host);

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log('harness_shutdown_started', { signal });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
    log('harness_shutdown_complete');
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  server.once('error', (error) => { throw error; });
  server.once('listening', async () => {
    const address = server.address();
    if (!address || typeof address === 'string') fail('server did not expose a TCP port');
    await atomicPortFile(config.portFile, address.port);
    log('harness_ready', { host: config.host, port: address.port, bridgeEnabled: config.bridgeEnabled });
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'harness_failed', message: error instanceof Error ? error.message : 'unknown error' })}\n`);
  process.exitCode = 1;
});
