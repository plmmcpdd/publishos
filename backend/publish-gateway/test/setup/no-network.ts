import dns from 'node:dns';
import { AsyncLocalStorage } from 'node:async_hooks';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import supertest from 'supertest';
import { afterAll, afterEach, beforeEach } from 'vitest';
import { defaultRateLimitStore } from '../../src/middleware/http-security';

/** A deliberately narrow test-only exception for a controlled network target. */
export type TestNetworkTarget = Readonly<{
  protocol: 'http:' | 'https:' | 'tcp:';
  hostname: string;
  port: number;
}>;

type ParsedTarget = Readonly<{
  protocol: 'http:' | 'https:' | 'tcp:' | 'dns:';
  hostname: string;
  port: number;
}>;
type MutableModule = Record<string, unknown>;

const allowedTargets = new Set<string>();
const supertestTargets = new Set<string>();
const permittedHttpTransport = new AsyncLocalStorage<ParsedTarget>();

const originals = {
  fetch: globalThis.fetch,
  httpRequest: http.request,
  httpGet: http.get,
  httpsRequest: https.request,
  httpsGet: https.get,
  connect: net.connect,
  createConnection: net.createConnection,
  lookup: dns.lookup,
  resolve: dns.resolve,
  resolve4: dns.resolve4,
  resolve6: dns.resolve6,
  supertestServerAddress: supertest.Test.prototype.serverAddress,
};

function targetKey(target: ParsedTarget): string {
  return `${target.protocol}//${target.hostname}:${target.port}`;
}

function defaultPort(protocol: TestNetworkTarget['protocol']): number {
  return protocol === 'https:' ? 443 : protocol === 'http:' ? 80 : 0;
}

function validateTarget(target: TestNetworkTarget): ParsedTarget {
  if (!target || typeof target !== 'object') throw new TypeError('Test network target must be an object');
  if (target.protocol !== 'http:' && target.protocol !== 'https:' && target.protocol !== 'tcp:') {
    throw new TypeError('Test network target protocol must be http:, https:, or tcp:');
  }
  if (typeof target.hostname !== 'string' || !target.hostname || /[\\/?#@*]/.test(target.hostname)) {
    throw new TypeError('Test network target hostname must be one exact hostname');
  }
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65_535) {
    throw new TypeError('Test network target port must be an integer from 1 to 65535');
  }
  return { protocol: target.protocol, hostname: target.hostname.toLowerCase(), port: target.port };
}

/** Explicitly permit exactly one protocol/hostname/port triple for the current test. */
export function allowTestNetworkTarget(target: TestNetworkTarget): void {
  allowedTargets.add(targetKey(validateTarget(target)));
}

/** Remove every explicit test exception immediately. */
export function clearTestNetworkAllowlist(): void {
  allowedTargets.clear();
}

function safeHostname(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  const candidate = text.replace(/^\[|\]$/g, '').split(/[\\/?#@]/, 1)[0];
  return candidate && /^[a-zA-Z0-9:.-]+$/.test(candidate) ? candidate.toLowerCase() : 'unknown';
}

function blocked(target: ParsedTarget): never {
  // Do not echo URL paths, queries, headers, or credentials into the failure.
  throw new Error(`Unexpected real network access blocked: ${targetKey(target)}`);
}

function parseUrlTarget(value: string | URL, fallbackProtocol: TestNetworkTarget['protocol']): ParsedTarget {
  try {
    const url = typeof value === 'string' ? new URL(value) : value;
    const protocol = url.protocol === 'http:' || url.protocol === 'https:' ? url.protocol : fallbackProtocol;
    return {
      protocol,
      hostname: safeHostname(url.hostname),
      port: Number(url.port || defaultPort(protocol)),
    };
  } catch {
    return { protocol: fallbackProtocol, hostname: 'unknown', port: defaultPort(fallbackProtocol) };
  }
}

function parseHttpTarget(input: unknown, fallbackProtocol: 'http:' | 'https:'): ParsedTarget {
  if (typeof input === 'string' || input instanceof URL) return parseUrlTarget(input, fallbackProtocol);

  const options = (input && typeof input === 'object' ? input : {}) as {
    protocol?: unknown; hostname?: unknown; host?: unknown; port?: unknown;
  };
  const protocol = options.protocol === 'https:' || options.protocol === 'http:' ? options.protocol : fallbackProtocol;
  const host = typeof options.hostname === 'string'
    ? options.hostname
    : typeof options.host === 'string'
      ? options.host.replace(/^\[([^\]]+)](?::\d+)?$/, '$1').replace(/:\d+$/, '')
      : 'localhost';
  const port = typeof options.port === 'number' || typeof options.port === 'string'
    ? Number(options.port)
    : defaultPort(protocol);
  return { protocol, hostname: safeHostname(host), port: Number.isInteger(port) && port > 0 ? port : defaultPort(protocol) };
}

function parseNetTarget(args: unknown[]): ParsedTarget {
  const first = args[0];
  if (typeof first === 'number') {
    return { protocol: 'tcp:', hostname: safeHostname(typeof args[1] === 'string' ? args[1] : 'localhost'), port: first };
  }
  if (typeof first === 'string') return parseUrlTarget(first, 'tcp:');
  const options = (first && typeof first === 'object' ? first : {}) as { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown };
  if (typeof options.path === 'string') return { protocol: 'tcp:', hostname: 'unix-socket', port: 0 };
  return {
    protocol: 'tcp:',
    hostname: safeHostname(typeof options.host === 'string' ? options.host : typeof options.hostname === 'string' ? options.hostname : 'localhost'),
    port: typeof options.port === 'number' ? options.port : Number(options.port || 0),
  };
}

function isAllowed(target: ParsedTarget): boolean {
  const key = targetKey(target);
  return allowedTargets.has(key) || supertestTargets.has(key);
}

function assertAllowed(target: ParsedTarget): void {
  if (!isAllowed(target)) blocked(target);
}

function withPermittedHttpTransport<T>(target: ParsedTarget, operation: () => T): T {
  assertAllowed(target);
  // Node's fetch and HTTP clients create their TCP socket asynchronously. Carry
  // the already-checked exact HTTP(S) target to that socket only; a direct
  // net.connect call never receives this context.
  return permittedHttpTransport.run(target, operation);
}

function assertPermittedTcpTransport(target: ParsedTarget): void {
  const httpTarget = permittedHttpTransport.getStore();
  const carriedTargetMatches = httpTarget
    && httpTarget.hostname === target.hostname
    && httpTarget.port === target.port
    && (httpTarget.protocol === 'http:' || httpTarget.protocol === 'https:');
  if (allowedTargets.has(targetKey(target)) || carriedTargetMatches) return;
  blocked(target);
}

function replace(module: MutableModule, name: string, replacement: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(module, name);
  if (!descriptor || (!descriptor.writable && !descriptor.configurable)) {
    throw new Error(`No-network guard cannot replace ${name}; refusing to install a partial guard`);
  }
  Object.defineProperty(module, name, { ...descriptor, value: replacement });
}

function restore(module: MutableModule, name: string, original: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(module, name);
  if (!descriptor || (!descriptor.writable && !descriptor.configurable)) {
    throw new Error(`No-network guard cannot restore ${name}`);
  }
  Object.defineProperty(module, name, { ...descriptor, value: original });
}

function installSupertestTracking(): void {
  supertest.Test.prototype.serverAddress = function patchedServerAddress(app, path) {
    const url = originals.supertestServerAddress.call(this, app, path);
    const target = parseUrlTarget(url, 'http:');
    // This is an exact target created by Supertest from an in-process Server.
    // It is not a hostname-wide localhost exception.
    supertestTargets.add(targetKey(target));
    return url;
  };
}

function restoreSupertestTracking(): void {
  supertest.Test.prototype.serverAddress = originals.supertestServerAddress;
}

function install(): void {
  replace(globalThis as MutableModule, 'fetch', ((input: string | URL | Request) => {
    const target = parseHttpTarget(input, 'https:');
    return withPermittedHttpTransport(target, () => originals.fetch(input));
  }) as typeof fetch);

  replace(http as unknown as MutableModule, 'request', ((...args: unknown[]) => {
    const target = parseHttpTarget(args[0], 'http:');
    return withPermittedHttpTransport(target, () => originals.httpRequest(...(args as Parameters<typeof http.request>)));
  }) as typeof http.request);
  replace(http as unknown as MutableModule, 'get', ((...args: unknown[]) => {
    const target = parseHttpTarget(args[0], 'http:');
    return withPermittedHttpTransport(target, () => originals.httpGet(...(args as Parameters<typeof http.get>)));
  }) as typeof http.get);
  replace(https as unknown as MutableModule, 'request', ((...args: unknown[]) => {
    const target = parseHttpTarget(args[0], 'https:');
    return withPermittedHttpTransport(target, () => originals.httpsRequest(...(args as Parameters<typeof https.request>)));
  }) as typeof https.request);
  replace(https as unknown as MutableModule, 'get', ((...args: unknown[]) => {
    const target = parseHttpTarget(args[0], 'https:');
    return withPermittedHttpTransport(target, () => originals.httpsGet(...(args as Parameters<typeof https.get>)));
  }) as typeof https.get);

  replace(net as unknown as MutableModule, 'connect', ((...args: unknown[]) => {
    assertPermittedTcpTransport(parseNetTarget(args));
    return originals.connect(...(args as Parameters<typeof net.connect>));
  }) as typeof net.connect);
  replace(net as unknown as MutableModule, 'createConnection', ((...args: unknown[]) => {
    assertPermittedTcpTransport(parseNetTarget(args));
    return originals.createConnection(...(args as Parameters<typeof net.createConnection>));
  }) as typeof net.createConnection);

  for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6'] as const) {
    replace(dns as unknown as MutableModule, name, ((hostname: unknown) => {
      blocked({ protocol: 'dns:', hostname: safeHostname(hostname), port: 0 });
    }) as unknown as typeof dns[typeof name]);
  }
  installSupertestTracking();
}

function restoreAll(): void {
  restore(globalThis as MutableModule, 'fetch', originals.fetch);
  restore(http as unknown as MutableModule, 'request', originals.httpRequest);
  restore(http as unknown as MutableModule, 'get', originals.httpGet);
  restore(https as unknown as MutableModule, 'request', originals.httpsRequest);
  restore(https as unknown as MutableModule, 'get', originals.httpsGet);
  restore(net as unknown as MutableModule, 'connect', originals.connect);
  restore(net as unknown as MutableModule, 'createConnection', originals.createConnection);
  restore(dns as unknown as MutableModule, 'lookup', originals.lookup);
  restore(dns as unknown as MutableModule, 'resolve', originals.resolve);
  restore(dns as unknown as MutableModule, 'resolve4', originals.resolve4);
  restore(dns as unknown as MutableModule, 'resolve6', originals.resolve6);
  restoreSupertestTracking();
}

beforeEach(() => install());
afterEach(() => {
  clearTestNetworkAllowlist();
  defaultRateLimitStore.clear();
  supertestTargets.clear();
  restoreAll();
});
afterAll(() => {
  clearTestNetworkAllowlist();
  defaultRateLimitStore.clear();
  supertestTargets.clear();
  restoreAll();
});
