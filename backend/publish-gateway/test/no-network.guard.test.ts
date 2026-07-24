import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { allowTestNetworkTarget, clearTestNetworkAllowlist } from './setup/no-network';

const BLOCKED = 'Unexpected real network access blocked';
const priorAllowlistTarget = { protocol: 'http:' as const, hostname: '127.0.0.1', port: 49_123 };

function listenFixture(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Omit host so Node binds an in-process ephemeral socket without DNS lookup.
    server.listen(0, () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Fixture did not bind a TCP port'));
      resolve(address.port);
    });
  });
}

function closeFixture(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

afterEach(() => clearTestNetworkAllowlist());

describe('Vitest no-network guard', () => {
  it.each([
    ['TikTok', 'https://open.tiktokapis.com/v2/oauth/token/'],
    ['Anthropic', 'https://api.anthropic.com/v1/messages'],
    ['S3', 'https://bucket.s3.amazonaws.com/upload'],
    ['metadata', 'http://169.254.169.254/latest/meta-data/iam'],
  ])('blocks %s fetch without making a request', (_name, url) => {
    expect(() => fetch(url)).toThrow(BLOCKED);
  });

  it('blocks http.request and http.get external targets', () => {
    expect(() => http.request('http://example.test/private')).toThrow(BLOCKED);
    expect(() => http.get('http://example.test/private')).toThrow(BLOCKED);
  });

  it('blocks https.request and https.get external targets', () => {
    expect(() => https.request('https://example.test/private')).toThrow(BLOCKED);
    expect(() => https.get('https://example.test/private')).toThrow(BLOCKED);
  });

  it('blocks net.connect and net.createConnection for unregistered targets', () => {
    expect(() => net.connect({ host: '127.0.0.1', port: 45_678 })).toThrow(BLOCKED);
    expect(() => net.createConnection({ host: '127.0.0.1', port: 45_678 })).toThrow(BLOCKED);
  });

  it('blocks dns.lookup, dns.resolve, dns.resolve4, and dns.resolve6', () => {
    expect(() => dns.lookup('example.test', () => undefined)).toThrow(BLOCKED);
    expect(() => dns.resolve('example.test', () => undefined)).toThrow(BLOCKED);
    expect(() => dns.resolve4('example.test', () => undefined)).toThrow(BLOCKED);
    expect(() => dns.resolve6('example.test', () => undefined)).toThrow(BLOCKED);
  });

  it('blocks unregistered localhost', () => {
    expect(() => http.request('http://127.0.0.1:49_122/')).toThrow(BLOCKED);
  });

  it('requires protocol, hostname, and port to match the allowlist exactly', () => {
    allowTestNetworkTarget(priorAllowlistTarget);
    expect(() => https.request('https://127.0.0.1:49123/')).toThrow(BLOCKED);
    expect(() => http.request('http://127.0.0.1:49124/')).toThrow(BLOCKED);
    expect(() => allowTestNetworkTarget({ protocol: 'http:', hostname: '*', port: 49123 })).toThrow('exact hostname');
  });

  it('permits only an explicitly registered random-port local HTTP fixture', async () => {
    const fixture = http.createServer((_req, res) => res.end('fixture-ok'));
    const port = await listenFixture(fixture);
    const target = { protocol: 'http:' as const, hostname: '127.0.0.1', port };
    try {
      allowTestNetworkTarget(target);
      const response = await fetch(`http://127.0.0.1:${port}/fixture`);
      expect(port).not.toBe(12345);
      expect(await response.text()).toBe('fixture-ok');
    } finally {
      clearTestNetworkAllowlist();
      await closeFixture(fixture);
    }
  });

  it('cannot connect to a closed registered fixture', async () => {
    const fixture = http.createServer((_req, res) => res.end('fixture-ok'));
    const port = await listenFixture(fixture);
    const target = { protocol: 'http:' as const, hostname: '127.0.0.1', port };
    try {
      allowTestNetworkTarget(target);
      await closeFixture(fixture);
      await expect(fetch(`http://127.0.0.1:${port}/after-close`)).rejects.toThrow();
    } finally {
      clearTestNetworkAllowlist();
      if (fixture.listening) await closeFixture(fixture);
    }
  });

  it('blocks the same target immediately after the allowlist is cleared', () => {
    allowTestNetworkTarget(priorAllowlistTarget);
    clearTestNetworkAllowlist();
    expect(() => http.request('http://127.0.0.1:49123/')).toThrow(BLOCKED);
  });

  it('starts with an empty allowlist after the previous test', () => {
    expect(() => http.request('http://127.0.0.1:49123/')).toThrow(BLOCKED);
  });

  it('keeps Supertest in-process Express calls working without a localhost-wide exemption', async () => {
    const app = express();
    app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('redacts Authorization and query values from blocked-network errors', () => {
    const authorization = 'Bearer very-secret-token';
    const querySecret = 'authorization-code-secret';
    expect(() => http.request({
      protocol: 'https:',
      hostname: 'example.test',
      path: `/callback?code=${querySecret}`,
      headers: { Authorization: authorization },
    })).toThrow(BLOCKED);
    try {
      http.request({
        protocol: 'https:',
        hostname: 'example.test',
        path: `/callback?code=${querySecret}`,
        headers: { Authorization: authorization },
      });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(authorization);
      expect(message).not.toContain(querySecret);
      expect(message).not.toContain('Authorization');
    }
  });
});
