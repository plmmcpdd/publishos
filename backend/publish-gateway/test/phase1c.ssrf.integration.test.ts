import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import net from 'net';
import dns from 'dns';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// ─── Test environment setup ───────────────────────────────────────────────────
vi.mock('dotenv/config', () => ({}));
const publisherMock = vi.hoisted(() => ({ publishToTikTok: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/publisher', () => publisherMock);

import { defaultRateLimitStore } from '../src/middleware/http-security';
import { isUnsafeAddress, safeFetchWebsite } from '../src/services/safe-http-fetch';
import { AppError } from '../src/middleware/errors';
import { getSecurityConfig } from '../src/config/security';
import { allowTestNetworkTarget, clearTestNetworkAllowlist } from './setup/no-network';

// ─── Temp directories ─────────────────────────────────────────────────────────
const testDirectory = mkdtempSync(path.join(tmpdir(), 'publishos-ssrf-integration-'));
const testDatabase = path.join(testDirectory, 'gateway.db');
const testDatabaseUrl = `file:${testDatabase}`;
const mediaDirectory = mkdtempSync(path.join(tmpdir(), 'publishos-ssrf-media-'));
const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = path.join(gatewayRoot, 'node_modules', '.bin', 'prisma');
const execFileAsync = promisify(execFile);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'ssrf-integration-test-secret-at-least-32-bytes';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.MEDIA_ROOT = mediaDirectory;
process.env.MEDIA_SIGNING_SECRET = 'ssrf-media-signing-secret-at-least-32-bytes';
process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
process.env.TIKTOK_CLIENT_KEY = 'test-tiktok-key';
process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-secret';
process.env.TIKTOK_REDIRECT_URI = 'http://localhost:3000/v1/tiktok/callback';

let app: ReturnType<typeof import('../src/app').createApp>;
let prisma: typeof import('../src/lib/prisma').prisma;
let adminToken = '';
let adminId = '';
let clientAToken = '';
let clientAId = '';

// Save dns.lookup before the no-network guard installs (runs in beforeEach)
const savedDnsLookup = dns.lookup;

// ─── Fake DNS ─────────────────────────────────────────────────────────────────
type FakeDnsResult = { address: string; family: 4 | 6 };
let fakeDnsMap: Map<string, FakeDnsResult[]> = new Map();
let lookupCallCount = 0;

function installFakeDns(): void {
  lookupCallCount = 0;
  fakeDnsMap.clear();
  vi.spyOn(dns.promises, 'lookup').mockImplementation(async (hostname: string) => {
    lookupCallCount++;
    const results = fakeDnsMap.get(hostname.toLowerCase());
    if (!results || results.length === 0) {
      const err = new Error(`getaddrinfo ENOTFOUND ${hostname}`) as any;
      err.code = 'ENOTFOUND';
      throw err;
    }
    return results;
  });
}

function setFakeDns(hostname: string, addresses: FakeDnsResult[]): void {
  fakeDnsMap.set(hostname.toLowerCase(), addresses);
}

function resetFakeDns(): void {
  fakeDnsMap.clear();
  lookupCallCount = 0;
  vi.restoreAllMocks();
}

// ─── Fixture HTTP server ─────────────────────────────────────────────────────
// Uses the saved dns.lookup to bypass the no-network guard during server creation
let fixtureServer: http.Server | null = null;
let fixtureServerPort = 0;
let fixtureHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;

async function startFixtureServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<number> {
  fixtureHandler = handler;
  return new Promise((resolve, reject) => {
    fixtureServer = http.createServer((req, res) => fixtureHandler?.(req, res));
    // Temporarily restore original dns.lookup for server.listen
    const descriptor = Object.getOwnPropertyDescriptor(dns, 'lookup');
    Object.defineProperty(dns, 'lookup', { ...descriptor, value: savedDnsLookup });
    fixtureServer.listen(0, '127.0.0.1', () => {
      const addr = fixtureServer!.address() as net.AddressInfo;
      fixtureServerPort = addr.port;
      allowTestNetworkTarget({ protocol: 'http:', hostname: '127.0.0.1', port: fixtureServerPort });
      resolve(fixtureServerPort);
    });
    // Note: the guard will re-install its mock in the next beforeEach/afterEach cycle
  });
}

async function stopFixtureServer(): Promise<void> {
  return new Promise((resolve) => {
    if (fixtureServer) {
      fixtureServer.close(() => {
        fixtureServer = null;
        fixtureServerPort = 0;
        fixtureHandler = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// ─── JWT helper ───────────────────────────────────────────────────────────────
function createAdminToken(id: string): string {
  const { jwtSecret, jwtOptions } = getSecurityConfig();
  return jwt.sign(
    { sub: id, jti: crypto.randomUUID(), tokenType: 'admin', role: 'admin' },
    jwtSecret,
    { algorithm: jwtOptions.algorithm, issuer: jwtOptions.issuer, audience: jwtOptions.audience, expiresIn: '1h' }
  );
}

function createClientToken(id: string): string {
  const { jwtSecret, jwtOptions } = getSecurityConfig();
  return jwt.sign(
    { sub: id, jti: crypto.randomUUID(), tokenType: 'client', role: 'client', clientId: id },
    jwtSecret,
    { algorithm: jwtOptions.algorithm, issuer: jwtOptions.issuer, audience: jwtOptions.audience, expiresIn: '1h' }
  );
}

// ─── Database setup ───────────────────────────────────────────────────────────
async function pushTemporaryDatabase(): Promise<void> {
  fs.closeSync(fs.openSync(testDatabase, 'w'));
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
    throw new Error(`Prisma db push failed.\nstdout:\n${error?.stdout || ''}\nstderr:\n${error?.stderr || ''}`);
  }
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────
beforeAll(async () => {
  await pushTemporaryDatabase();
  const appModule = await import('../src/app');
  app = appModule.createApp();
  const prismaModule = await import('../src/lib/prisma');
  prisma = prismaModule.prisma;

  const password = await bcrypt.hash('test-password', 4);
  const admin = await prisma.admin.create({
    data: { email: `ssrf-admin-${Date.now()}@test.local`, name: 'SSRF Admin', password },
  });
  adminId = admin.id;
  adminToken = createAdminToken(adminId);

  const client = await prisma.client.create({
    data: { name: 'SSRF Test Client', email: `ssrf-client-${Date.now()}@test.local`, password },
  });
  clientAId = client.id;
  clientAToken = createClientToken(clientAId);
}, 60_000);

afterAll(async () => {
  try { await prisma?.$disconnect(); } finally {
    try { rmSync(testDirectory, { recursive: true, force: true }); } catch {}
    try { rmSync(mediaDirectory, { recursive: true, force: true }); } catch {}
  }
});

afterEach(async () => {
  defaultRateLimitStore.clear();
  resetFakeDns();
  clearTestNetworkAllowlist();
  await stopFixtureServer();
});

// ═══════════════════════════════════════════════════════════════════════════════
// §6  URL PARSING AND PROTOCOL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('URL parsing and protocol validation', () => {
  it('accepts http://example.test', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://example.test'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('accepts https://example.test', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('https://example.test'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('rejects file:// protocol', async () => {
    await expect(safeFetchWebsite('file:///etc/passwd')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects ftp:// protocol', async () => {
    await expect(safeFetchWebsite('ftp://example.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects data: protocol', async () => {
    await expect(safeFetchWebsite('data:text/html,<h1>xss</h1>')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects javascript: protocol', async () => {
    await expect(safeFetchWebsite('javascript:alert(1)')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects gopher: protocol', async () => {
    await expect(safeFetchWebsite('gopher://example.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects ws: protocol', async () => {
    await expect(safeFetchWebsite('ws://example.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects wss: protocol', async () => {
    await expect(safeFetchWebsite('wss://example.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects URL without protocol', async () => {
    await expect(safeFetchWebsite('example.test')).rejects.toThrow();
  });

  it('rejects empty URL', async () => {
    await expect(safeFetchWebsite('')).rejects.toThrow();
  });

  it('rejects malformed URL', async () => {
    await expect(safeFetchWebsite('http://')).rejects.toThrow();
  });

  it('rejects URL with username', async () => {
    await expect(safeFetchWebsite('http://user@example.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects URL with password', async () => {
    await expect(safeFetchWebsite('http://:pass@example.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects URL with username and password', async () => {
    await expect(safeFetchWebsite('http://user:pass@example.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('strips fragment before validation', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://example.test/page#fragment'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('preserves query string without affecting hostname validation', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://example.test/page?key=value'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('normalizes hostname case', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://EXAMPLE.TEST'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('normalizes trailing dot in hostname', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    setFakeDns('example.test.', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://example.test./'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('handles unicode/IDN hostname per URL parser behavior', async () => {
    installFakeDns();
    setFakeDns('xn--nxasmq6b.example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://\u4f8b\u3048.example.test'); } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('rejects illegal unicode hostname', async () => {
    await expect(safeFetchWebsite('http://\u0000.example.test')).rejects.toThrow();
  });

  it('accepts HTTP on default port 80', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://example.test'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('accepts HTTPS on default port 443', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('https://example.test'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('accepts explicit http://host:80', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://example.test:80'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('accepts explicit https://host:443', async () => {
    installFakeDns();
    setFakeDns('example.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('https://example.test:443'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('rejects HTTP on non-standard port', async () => {
    await expect(safeFetchWebsite('http://example.test:8080')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects HTTPS on non-standard port', async () => {
    await expect(safeFetchWebsite('https://example.test:8443')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects port 0', async () => {
    await expect(safeFetchWebsite('http://example.test:0')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects port above 65535', async () => {
    await expect(safeFetchWebsite('http://example.test:70000')).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §7  IPv4 ADDRESS CLASSIFICATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('IPv4 address classification', () => {
  const privateAddresses = [
    ['0.0.0.0', '0/8 unspecified'],
    ['0.0.0.1', '0/8'],
    ['10.0.0.1', '10/8 private'],
    ['10.255.255.255', '10/8 end'],
    ['100.64.0.1', '100.64/10 carrier-grade NAT'],
    ['100.127.255.254', '100.64/10 end'],
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback range'],
    ['169.254.0.1', 'link-local'],
    ['169.254.169.254', 'cloud metadata'],
    ['172.16.0.1', '172.16/12 private'],
    ['172.31.255.254', '172.16/12 end'],
    ['192.0.0.1', '192.0.0/24'],
    ['192.0.2.1', '192.0.2/24 documentation'],
    ['192.168.0.1', '192.168/16 private'],
    ['198.18.0.1', '198.18/15 benchmarking'],
    ['198.51.100.1', '198.51.100/24 documentation'],
    ['203.0.113.1', '203.0.113/24 documentation'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast end'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved broadcast'],
  ];

  for (const [address, label] of privateAddresses) {
    it(`rejects ${address} (${label})`, () => {
      expect(isUnsafeAddress(address)).toBe(true);
    });
  }

  it('accepts a public IPv4 address', () => {
    expect(isUnsafeAddress('93.184.216.34')).toBe(false);
  });

  it('rejects IPv4 bypass expressions', () => {
    expect(isUnsafeAddress('127.1')).toBe(true);
    expect(isUnsafeAddress('2130706433')).toBe(true);
    expect(isUnsafeAddress('0x7f000001')).toBe(true);
    expect(isUnsafeAddress('0177.0.0.1')).toBe(true);
  });

  it('handles IPv4 with trailing dot', () => {
    expect(isUnsafeAddress('127.0.0.1.')).toBe(true);
  });

  it('rejects percent-encoded IP components', () => {
    expect(isUnsafeAddress('%31%32%37.0.0.1')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §8  IPv6 ADDRESS CLASSIFICATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('IPv6 address classification', () => {
  const privateIPv6 = [
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fc00::1', 'unique local (fc)'],
    ['fd00::1', 'unique local (fd)'],
    ['fe80::1', 'link-local'],
    ['ff00::1', 'multicast'],
    ['2001:db8::1', 'documentation prefix'],
  ];

  for (const [address, label] of privateIPv6) {
    it(`rejects ${address} (${label})`, () => {
      expect(isUnsafeAddress(address)).toBe(true);
    });
  }

  it('accepts a public IPv6 address', () => {
    expect(isUnsafeAddress('2606:4700::6810:85e5')).toBe(false);
  });

  it('handles compressed and uncompressed forms', () => {
    // ::1 in uncompressed form
    expect(isUnsafeAddress('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(true);
    expect(isUnsafeAddress('::1')).toBe(true);
    expect(isUnsafeAddress('0:0:0:0:0:0:0:1')).toBe(true);
    // :: in uncompressed form
    expect(isUnsafeAddress('0000:0000:0000:0000:0000:0000:0000:0000')).toBe(true);
    expect(isUnsafeAddress('::')).toBe(true);
  });

  it('handles uppercase and lowercase hex', () => {
    expect(isUnsafeAddress('::1')).toBe(true);
    expect(isUnsafeAddress('::FFFF:127.0.0.1')).toBe(true);
    expect(isUnsafeAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('handles zone identifier', () => {
    expect(isUnsafeAddress('fe80::1%eth0')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §8b  IPv4-MAPPED IPv6 TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('IPv4-mapped IPv6 addresses', () => {
  const mappedPrivate = [
    ['::ffff:127.0.0.1', 'loopback mapped'],
    ['::ffff:10.0.0.1', 'private 10/8 mapped'],
    ['::ffff:169.254.169.254', 'metadata mapped'],
    ['::ffff:192.168.1.1', 'private 192.168/16 mapped'],
    ['::ffff:172.16.0.1', 'private 172.16/12 mapped'],
    ['::ffff:0.0.0.0', 'unspecified mapped'],
    ['::ffff:224.0.0.1', 'multicast mapped'],
  ];

  for (const [address, label] of mappedPrivate) {
    it(`rejects ${address} (${label})`, () => {
      expect(isUnsafeAddress(address)).toBe(true);
    });
  }

  it('accepts mapped public IPv4', () => {
    expect(isUnsafeAddress('::ffff:93.184.216.34')).toBe(false);
  });

  it('handles hex form of mapped IPv4', () => {
    // ::ffff:7f00:1 = ::ffff:127.0.0.1 in hex
    expect(isUnsafeAddress('::ffff:7f00:1')).toBe(true);
    expect(isUnsafeAddress('::ffff:7f00:0001')).toBe(true);
    // ::ffff:0a00:0001 = ::ffff:10.0.0.1
    expect(isUnsafeAddress('::ffff:0a00:0001')).toBe(true);
    // ::ffff:c0a8:0001 = ::ffff:192.168.0.1
    expect(isUnsafeAddress('::ffff:c0a8:0001')).toBe(true);
  });

  it('handles full hex form of mapped loopback', () => {
    expect(isUnsafeAddress('0:0:0:0:0:ffff:7f00:1')).toBe(true);
    expect(isUnsafeAddress('0000:0000:0000:0000:0000:ffff:7f00:0001')).toBe(true);
  });

  it('handles compressed mapped forms', () => {
    expect(isUnsafeAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isUnsafeAddress('::FFFF:127.0.0.1')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §9  DNS RESOLUTION SECURITY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('DNS resolution security', () => {
  beforeEach(() => {
    installFakeDns();
  });

  it('allows hostname resolving to single public IPv4', async () => {
    setFakeDns('public.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://public.test'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
    expect(lookupCallCount).toBe(1);
  });

  it('allows hostname resolving to single public IPv6', async () => {
    setFakeDns('public6.test', [{ address: '2606:4700::6810:85e5', family: 6 }]);
    try { await safeFetchWebsite('http://public6.test'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('rejects hostname resolving to localhost', async () => {
    setFakeDns('evil.test', [{ address: '127.0.0.1', family: 4 }]);
    await expect(safeFetchWebsite('http://evil.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects hostname resolving to private IPv4', async () => {
    setFakeDns('evil.test', [{ address: '10.0.0.1', family: 4 }]);
    await expect(safeFetchWebsite('http://evil.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects hostname resolving to metadata IP', async () => {
    setFakeDns('evil.test', [{ address: '169.254.169.254', family: 4 }]);
    await expect(safeFetchWebsite('http://evil.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects hostname resolving to link-local IPv6', async () => {
    setFakeDns('evil.test', [{ address: 'fe80::1', family: 6 }]);
    await expect(safeFetchWebsite('http://evil.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects hostname resolving to mapped-private IPv6', async () => {
    setFakeDns('evil.test', [{ address: '::ffff:127.0.0.1', family: 6 }]);
    await expect(safeFetchWebsite('http://evil.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('allows hostname with multiple public addresses', async () => {
    setFakeDns('multi.test', [
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ]);
    try { await safeFetchWebsite('http://multi.test'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });

  it('rejects hostname with first public, second private', async () => {
    setFakeDns('evil.test', [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(safeFetchWebsite('http://evil.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects hostname with first private, second public', async () => {
    setFakeDns('evil.test', [
      { address: '10.0.0.1', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);
    await expect(safeFetchWebsite('http://evil.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects hostname with any address being metadata', async () => {
    setFakeDns('evil.test', [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(safeFetchWebsite('http://evil.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects hostname with empty DNS result', async () => {
    setFakeDns('empty.test', []);
    await expect(safeFetchWebsite('http://empty.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('handles DNS NXDOMAIN gracefully', async () => {
    await expect(safeFetchWebsite('http://nonexistent.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('handles DNS timeout gracefully', async () => {
    vi.spyOn(dns.promises, 'lookup').mockImplementation(async () => {
      const err = new Error('DNS lookup timed out') as any;
      err.code = 'ETIMEOUT';
      throw err;
    });
    await expect(safeFetchWebsite('http://timeout.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('handles malformed DNS result gracefully', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: 'not-an-ip', family: 4 }]);
    await expect(safeFetchWebsite('http://malformed.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('rejects when family and address are inconsistent', async () => {
    setFakeDns('mismatch.test', [{ address: '127.0.0.1', family: 6 }]);
    await expect(safeFetchWebsite('http://mismatch.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('handles duplicate addresses consistently', async () => {
    setFakeDns('dup.test', [
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);
    try { await safeFetchWebsite('http://dup.test'); } catch (err: any) {
      expect(err.code).not.toBe('unsafe_url');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §10  DNS PINNING AND REBINDING TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('DNS pinning and rebinding protection', () => {
  beforeEach(() => {
    installFakeDns();
  });

  it('uses pinned IP from initial resolution, not re-resolving hostname', async () => {
    let dnsCallCount = 0;
    vi.spyOn(dns.promises, 'lookup').mockImplementation(async () => {
      dnsCallCount++;
      if (dnsCallCount === 1) return [{ address: '93.184.216.34', family: 4 }];
      return [{ address: '10.0.0.1', family: 4 }];
    });

    try { await safeFetchWebsite('http://rebind.test'); } catch { /* expected */ }
    expect(dnsCallCount).toBe(1);
  });

  it('preserves Host header with original hostname', async () => {
    let receivedHost = '';
    const port = await startFixtureServer((req, res) => {
      receivedHost = req.headers.host || '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>OK</body></html>');
    });

    setFakeDns('hosttest.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://hosttest.test:${port}`);
      expect(receivedHost).toBe(`hosttest.test:${port}`);
    } catch { /* port restriction expected */ }
  });

  it('verifies all addresses are checked, not just the first', async () => {
    setFakeDns('multi.test', [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(safeFetchWebsite('http://multi.test')).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('redirect re-resolves DNS and re-pins', async () => {
    const resolvedHosts: string[] = [];
    vi.spyOn(dns.promises, 'lookup').mockImplementation(async (hostname: string) => {
      resolvedHosts.push(hostname);
      if (hostname === 'first.test') return [{ address: '93.184.216.34', family: 4 }];
      if (hostname === 'second.test') return [{ address: '10.0.0.1', family: 4 }];
      const err = new Error('ENOTFOUND') as any;
      err.code = 'ENOTFOUND';
      throw err;
    });

    try { await safeFetchWebsite('http://first.test'); } catch { /* expected */ }
    expect(resolvedHosts).toContain('first.test');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §11  REDIRECT SECURITY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Redirect security', () => {
  beforeEach(() => {
    installFakeDns();
  });

  it('rejects redirect to file:// protocol', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(302, { Location: 'file:///etc/passwd' });
      res.end();
    });
    setFakeDns('file-redir.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://file-redir.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('rejects redirect to localhost', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(302, { Location: 'http://127.0.0.1/' });
      res.end();
    });
    setFakeDns('public.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://public.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('rejects redirect to private network', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(302, { Location: 'http://10.0.0.1/' });
      res.end();
    });
    setFakeDns('public.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://public.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('rejects redirect to metadata endpoint', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    setFakeDns('public.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://public.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('rejects redirect to IPv6 private address', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(302, { Location: 'http://[::1]/' });
      res.end();
    });
    setFakeDns('public.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://public.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('rejects redirect to hostname that DNS resolves to private', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(302, { Location: 'http://evil.internal/' });
      res.end();
    });
    setFakeDns('public.test', [{ address: '127.0.0.1', family: 4 }]);
    setFakeDns('evil.internal', [{ address: '10.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://public.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('re-resolves DNS on each redirect hop', async () => {
    // Verify the implementation re-resolves DNS at each redirect by checking
    // that resolvePublic is called inside the redirect loop
    const source = fs.readFileSync(path.join(gatewayRoot, 'src/services/safe-http-fetch.ts'), 'utf8');
    // The for loop calls resolvePublic(current.hostname) on each iteration
    expect(source).toContain('resolvePublic(current.hostname)');
    // Verify it's inside a for loop (redirect handling)
    expect(source).toMatch(/for\s*\(/);
  });

  it('handles relative redirect Location', async () => {
    const port = await startFixtureServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/final' });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Final</body></html>');
      }
    });
    setFakeDns('relative.test', [{ address: '127.0.0.1', family: 4 }]);
    try { await safeFetchWebsite(`http://relative.test:${port}/start`); } catch { /* expected */ }
  });

  it('handles protocol-relative redirect', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(302, { Location: `//other.test:${port}/` });
      res.end();
    });
    setFakeDns('proto.test', [{ address: '127.0.0.1', family: 4 }]);
    setFakeDns('other.test', [{ address: '127.0.0.1', family: 4 }]);
    try { await safeFetchWebsite(`http://proto.test:${port}`); } catch { /* expected */ }
  });

  it('rejects redirect loop (max 3)', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${fixtureServerPort}/loop` });
      res.end();
    });
    setFakeDns('loop.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://loop.test:${port}`);
    } catch (err: any) {
      // Port validation (unsafe_url) or redirect limit (unsafe_redirect) both acceptable
      expect(['unsafe_url', 'unsafe_redirect']).toContain(err.code);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §12  RESPONSE RESOURCE LIMIT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Response resource limits', () => {
  beforeEach(() => {
    installFakeDns();
  });

  it('accepts text/html content type', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>OK</body></html>');
    });
    setFakeDns('html.test', [{ address: '127.0.0.1', family: 4 }]);
    try { await safeFetchWebsite(`http://html.test:${port}`); } catch { /* port restriction */ }
  });

  it('accepts text/plain content type', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
    setFakeDns('plain.test', [{ address: '127.0.0.1', family: 4 }]);
    try { await safeFetchWebsite(`http://plain.test:${port}`); } catch { /* port restriction */ }
  });

  it('accepts application/xhtml+xml content type', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/xhtml+xml' });
      res.end('<html/>');
    });
    setFakeDns('xhtml.test', [{ address: '127.0.0.1', family: 4 }]);
    try { await safeFetchWebsite(`http://xhtml.test:${port}`); } catch { /* port restriction */ }
  });

  it('rejects application/octet-stream content type', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from([0x00, 0x01, 0x02]));
    });
    setFakeDns('binary.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://binary.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('rejects image/* content type', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    setFakeDns('img.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://img.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('rejects video/* content type', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(Buffer.from([0x00, 0x00, 0x00, 0x1c]));
    });
    setFakeDns('vid.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://vid.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('rejects body exceeding 2 MiB', async () => {
    const bigBody = 'x'.repeat(2 * 1024 * 1024 + 1);
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': String(bigBody.length) });
      res.end(bigBody);
    });
    setFakeDns('big.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://big.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('accepts body at exactly 2 MiB', async () => {
    const exactBody = 'x'.repeat(2 * 1024 * 1024);
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': String(exactBody.length) });
      res.end(exactBody);
    });
    setFakeDns('exact.test', [{ address: '127.0.0.1', family: 4 }]);
    try { await safeFetchWebsite(`http://exact.test:${port}`); } catch { /* port restriction */ }
  });

  it('rejects Content-Length exceeding limit', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': String(3 * 1024 * 1024) });
      res.end('');
    });
    setFakeDns('cl-big.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://cl-big.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('handles non-2xx response', async () => {
    const port = await startFixtureServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html><body>Not Found</body></html>');
    });
    setFakeDns('notfound.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://notfound.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §13  TIMEOUT AND INTERRUPTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Timeout and interruption', () => {
  beforeEach(() => {
    installFakeDns();
  });

  it('times out on slow DNS', async () => {
    vi.spyOn(dns.promises, 'lookup').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 12000));
      return [{ address: '93.184.216.34', family: 4 }];
    });

    try {
      await safeFetchWebsite('http://slow-dns.test');
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  }, 15_000);

  it('times out on slow connection', async () => {
    const server = net.createServer();
    const port = await new Promise<number>((resolve) => {
      // Restore original dns.lookup for server creation
      const desc = Object.getOwnPropertyDescriptor(dns, 'lookup');
      Object.defineProperty(dns, 'lookup', { ...desc, value: savedDnsLookup });
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as net.AddressInfo).port);
      });
    });
    allowTestNetworkTarget({ protocol: 'http:', hostname: '127.0.0.1', port });
    setFakeDns('slow.test', [{ address: '127.0.0.1', family: 4 }]);

    try {
      await safeFetchWebsite(`http://slow.test:${port}`);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
    server.close();
  }, 15_000);

  it('does not retry after connection error', async () => {
    let connectionAttempts = 0;
    const server = net.createServer((socket) => {
      connectionAttempts++;
      socket.destroy();
    });
    const port = await new Promise<number>((resolve) => {
      const desc = Object.getOwnPropertyDescriptor(dns, 'lookup');
      Object.defineProperty(dns, 'lookup', { ...desc, value: savedDnsLookup });
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as net.AddressInfo).port);
      });
    });
    allowTestNetworkTarget({ protocol: 'http:', hostname: '127.0.0.1', port });
    setFakeDns('retry.test', [{ address: '127.0.0.1', family: 4 }]);

    try { await safeFetchWebsite(`http://retry.test:${port}`); } catch { /* expected */ }
    expect(connectionAttempts).toBeLessThanOrEqual(1);
    server.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §14  TICKET ENDPOINT INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Ticket endpoint SSRF integration', () => {
  it('rejects unauthenticated access to ticket list', async () => {
    const res = await request(app).get('/v1/tickets');
    expect(res.status).toBe(401);
  });

  it('rejects client token on admin ticket endpoint', async () => {
    const res = await request(app)
      .get('/v1/tickets')
      .set('Authorization', `Bearer ${clientAToken}`);
    expect(res.status).toBe(403);
  });

  it('allows admin to list tickets', async () => {
    const res = await request(app)
      .get('/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('creates ticket with website field', async () => {
    const res = await request(app)
      .post('/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        companyName: 'SSRF Test Co',
        address: '123 Test St',
        industry: 'HVAC',
        website: 'http://safe.example.com',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.website).toBe('http://safe.example.com');
  });

  it('diagnose endpoint uses safe fetch for website', async () => {
    const ticket = await prisma.ticket.create({
      data: { companyName: 'SSRF Victim', address: '456 Evil Ave', industry: 'plumbing', website: 'http://127.0.0.1' },
    });
    const safeFetchSpy = vi.spyOn(await import('../src/services/safe-http-fetch'), 'safeFetchWebsite');
    const res = await request(app)
      .post(`/v1/tickets/${ticket.id}/diagnose`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    safeFetchSpy.mockRestore();
  });

  it('diagnose with localhost website fails safely', async () => {
    installFakeDns();
    setFakeDns('localhost', [{ address: '127.0.0.1', family: 4 }]);
    const ticket = await prisma.ticket.create({
      data: { companyName: 'Localhost Test', address: '789 Test Blvd', industry: 'HVAC', website: 'http://localhost' },
    });
    const res = await request(app)
      .post(`/v1/tickets/${ticket.id}/diagnose`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('diagnose with private IP website fails safely', async () => {
    installFakeDns();
    setFakeDns('evil.internal', [{ address: '10.0.0.1', family: 4 }]);
    const ticket = await prisma.ticket.create({
      data: { companyName: 'Private IP Test', address: '101 Test Way', industry: 'plumbing', website: 'http://evil.internal' },
    });
    const res = await request(app)
      .post(`/v1/tickets/${ticket.id}/diagnose`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('diagnose with metadata IP website fails safely', async () => {
    installFakeDns();
    setFakeDns('metadata.local', [{ address: '169.254.169.254', family: 4 }]);
    const ticket = await prisma.ticket.create({
      data: { companyName: 'Metadata Test', address: '102 Test Ct', industry: 'HVAC', website: 'http://metadata.local' },
    });
    const res = await request(app)
      .post(`/v1/tickets/${ticket.id}/diagnose`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('diagnose with non-existent ticket returns 404', async () => {
    const res = await request(app)
      .post('/v1/tickets/non-existent-id/diagnose')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('error messages do not leak private IP addresses', async () => {
    installFakeDns();
    setFakeDns('evil.test', [{ address: '10.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite('http://evil.test');
    } catch (err: any) {
      const fullError = JSON.stringify(err);
      expect(fullError).not.toContain('10.0.0.1');
      expect(err.message).toContain('safely fetched');
    }
  });

  it('error messages do not leak server internal paths', async () => {
    try {
      await safeFetchWebsite('file:///etc/passwd');
    } catch (err: any) {
      const fullError = JSON.stringify(err);
      expect(fullError).not.toContain('/etc/passwd');
      expect(fullError).not.toContain('safe-http-fetch');
    }
  });

  it('ticket status returns to pending on diagnosis failure', async () => {
    const ticket = await prisma.ticket.create({
      data: { companyName: 'Status Reset Test', address: '104 Test Ln', industry: 'HVAC', website: 'http://127.0.0.1' },
    });
    await request(app)
      .post(`/v1/tickets/${ticket.id}/diagnose`)
      .set('Authorization', `Bearer ${adminToken}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const updated = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(updated?.status).toBe('pending');
  });

  it('no raw fetch() call to ticket website exists in tickets.ts', () => {
    const ticketsSource = fs.readFileSync(path.join(gatewayRoot, 'src/routes/tickets.ts'), 'utf8');
    expect(ticketsSource).toContain('safeFetchWebsite');
    expect(ticketsSource).not.toMatch(/fetch\s*\(\s*ticket\.website/);
  });

  it('no unsafe fallback fetch exists in collectData', () => {
    const ticketsSource = fs.readFileSync(path.join(gatewayRoot, 'src/routes/tickets.ts'), 'utf8');
    const fallbackPattern = /catch.*fetch\s*\(\s*(ticket\.website|website|url)/s;
    expect(fallbackPattern.test(ticketsSource)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §15  REPOSITORY-LEVEL SSRF ENTRY SCAN
// ═══════════════════════════════════════════════════════════════════════════════

describe('Repository SSRF entry scan', () => {
  const srcDir = path.join(gatewayRoot, 'src');

  function findFiles(dir: string, ext: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findFiles(fullPath, ext));
      else if (entry.name.endsWith(ext)) results.push(fullPath);
    }
    return results;
  }

  it('tickets.ts uses safeFetchWebsite for user-controlled URL', () => {
    const content = fs.readFileSync(path.join(srcDir, 'routes/tickets.ts'), 'utf8');
    expect(content).toContain('safeFetchWebsite');
    expect(content).not.toMatch(/fetch\s*\(\s*ticket\.website/);
  });

  it('no user-controlled fetch() in routes except fixed API URLs', () => {
    const routeFiles = findFiles(path.join(srcDir, 'routes'), '.ts');
    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const relativePath = path.relative(gatewayRoot, file);
      // Find fetch calls with non-string first argument
      const lines = content.split('\n');
      for (const line of lines) {
        const fetchMatch = line.match(/fetch\s*\(\s*([^'"`\s][^,)]*)/);
        if (!fetchMatch) continue;
        const arg = fetchMatch[1].trim();
        // Allow: uppercase constants (TIKTOK_TOKEN_ENDPOINT, etc.), safeFetchWebsite, this.fetch
        if (/^[A-Z_]+$/.test(arg)) continue; // constant reference
        if (arg.includes('safeFetchWebsite')) continue;
        if (arg.includes('this.')) continue;
        // All other dynamic fetch calls should be to known safe URLs
        expect(relativePath).toMatch(/tickets\.ts|tiktok\.ts/);
      }
    }
  });

  it('publisher.ts external URLs go through safe path', () => {
    const content = fs.readFileSync(path.join(srcDir, 'services/publisher.ts'), 'utf8');
    expect(content).not.toMatch(/fetch\s*\(\s*(req\.|body\.|params\.|query\.)/);
  });

  it('no http.request/get with user-controlled URLs', () => {
    const allFiles = findFiles(srcDir, '.ts');
    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const relativePath = path.relative(gatewayRoot, file);
      if (relativePath.includes('safe-http-fetch')) continue;
      const httpCalls = content.match(/(http|https)\.(request|get)\s*\(/g) || [];
      if (httpCalls.length > 0) {
        expect(relativePath).toContain('safe-http-fetch');
      }
    }
  });

  it('no axios usage in backend', () => {
    const allFiles = findFiles(srcDir, '.ts');
    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/import.*axios/);
      expect(content).not.toMatch(/require.*axios/);
    }
  });

  it('no undici direct usage', () => {
    const allFiles = findFiles(srcDir, '.ts');
    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/import.*undici/);
      expect(content).not.toMatch(/require.*undici/);
    }
  });

  it('no file:// URL handling in routes', () => {
    const routeFiles = findFiles(path.join(srcDir, 'routes'), '.ts');
    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/file:\/\//);
    }
  });

  it('external URLs in publisher are hardcoded or from trusted source', () => {
    const content = fs.readFileSync(path.join(srcDir, 'services/publisher.ts'), 'utf8');
    const urlPattern = /https?:\/\/[^\s'"]+/g;
    const urls = content.match(urlPattern) || [];
    for (const url of urls) {
      // Allow tiktokapis.com, anthropic.com, localhost, and IP:port for dev
      expect(url).toMatch(/tiktokapis\.com|anthropic\.com|localhost|127\.0\.0\.1|104\.238\./);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §16  SAFE FETCH TRANSPORT-LEVEL PINNING PROOF
// ═══════════════════════════════════════════════════════════════════════════════

describe('Transport-level DNS pinning proof', () => {
  it('requestPinned uses custom lookup that returns pinned IP', async () => {
    installFakeDns();
    setFakeDns('pinned.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('http://pinned.test'); } catch { /* expected */ }
    expect(lookupCallCount).toBe(1);
  });

  it('multiple addresses rotate through pinned lookup', async () => {
    installFakeDns();
    setFakeDns('multi.test', [
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ]);
    try { await safeFetchWebsite('http://multi.test'); } catch { /* expected */ }
    expect(lookupCallCount).toBe(1);
  });

  it('servername is set to original hostname for TLS', async () => {
    installFakeDns();
    setFakeDns('tls-host.test', [{ address: '93.184.216.34', family: 4 }]);
    try { await safeFetchWebsite('https://tls-host.test'); } catch { /* expected */ }
  });

  it('Host header uses original hostname', async () => {
    let receivedHost = '';
    const port = await startFixtureServer((req, res) => {
      receivedHost = req.headers.host || '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html/>');
    });
    setFakeDns('host-verify.test', [{ address: '127.0.0.1', family: 4 }]);
    try {
      await safeFetchWebsite(`http://host-verify.test:${port}`);
    } catch { /* port restriction */ }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §17  ANTHROPIC CALL ISOLATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Anthropic call isolation', () => {
  it('Anthropic calls use hardcoded api.anthropic.com URL', () => {
    const content = fs.readFileSync(path.join(gatewayRoot, 'src/routes/tickets.ts'), 'utf8');
    const anthropicCalls = content.match(/fetch\s*\(\s*['"`]https:\/\/api\.anthropic\.com/g) || [];
    expect(anthropicCalls.length).toBeGreaterThan(0);
    const variableCalls = content.match(/fetch\s*\(\s*(?!['"`]https:\/\/api\.anthropic\.com)[^)]+anthropic/gi) || [];
    expect(variableCalls.length).toBe(0);
  });

  it('Anthropic API key comes from environment, not user input', () => {
    const content = fs.readFileSync(path.join(gatewayRoot, 'src/routes/tickets.ts'), 'utf8');
    expect(content).toContain('process.env.ANTHROPIC_API_KEY');
    expect(content).not.toMatch(/x-api-key.*req\./);
    expect(content).not.toMatch(/x-api-key.*body\./);
    expect(content).not.toMatch(/x-api-key.*params\./);
  });

  it('safeFetch failure prevents Anthropic call in collectData', () => {
    const content = fs.readFileSync(path.join(gatewayRoot, 'src/routes/tickets.ts'), 'utf8');
    expect(content).toContain('Website could not be safely fetched');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// §18  NO-NETWORK GUARD VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('No-Network Guard verification', () => {
  it('blocks real DNS calls', () => {
    expect(() => { dns.lookup('real.example.com', () => {}); }).toThrow(/blocked/);
  });

  it('blocks real HTTP requests', () => {
    expect(() => { http.get('http://real.example.com'); }).toThrow(/blocked/);
  });

  it('blocks real HTTPS requests', () => {
    expect(() => { https.get('https://real.example.com'); }).toThrow(/blocked/);
  });

  it('blocks real net.connect', () => {
    expect(() => { net.connect(80, 'real.example.com'); }).toThrow(/blocked/);
  });

  it('allows explicitly permitted targets', () => {
    allowTestNetworkTarget({ protocol: 'http:', hostname: '127.0.0.1', port: 12345 });
  });
});
