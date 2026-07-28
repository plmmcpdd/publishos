import crypto from 'crypto';
import path from 'path';
import type { SignOptions } from 'jsonwebtoken';

export const JWT_ISSUER = 'publishos';
export const JWT_AUDIENCE = 'publishos-api';

export interface SecurityConfig {
  jwtSecret: string;
  jwtOptions: Pick<SignOptions, 'algorithm' | 'issuer' | 'audience'>;
}

export interface MediaConfig {
  root: string;
  signingSecret: string;
  ttlSeconds: number;
  publicBaseUrl: string;
  videoMaxBytes: number;
  imageMaxBytes: number;
}

export interface HttpSecurityConfig {
  allowedOrigins: string[];
  allowNullOrigin: boolean;
  corsMaxAgeSeconds: number;
  trustProxyHops: number;
}

export interface OpsBrainBridgeConfig {
  enabled: boolean;
  token?: string;
}

export type AppEnvironment = 'development' | 'test' | 'staging' | 'production';

export interface RuntimeConfig {
  appEnv: AppEnvironment;
  host: string;
  port: number;
  tiktokIntegrationEnabled: boolean;
  backgroundJobsEnabled: boolean;
  metricsCronEnabled: boolean;
  reconciliationCronEnabled: boolean;
  startupReconciliationEnabled: boolean;
}

let cachedConfig: SecurityConfig | undefined;

export function loadSecurityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET must be configured');
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) throw new Error('JWT_SECRET must be at least 32 bytes');

  return {
    jwtSecret,
    jwtOptions: { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
  };
}

export function initializeSecurityConfig(): SecurityConfig {
  cachedConfig = loadSecurityConfig();
  return cachedConfig;
}

export function getSecurityConfig(): SecurityConfig {
  return cachedConfig ?? initializeSecurityConfig();
}

export function newJwtId(): string {
  return crypto.randomUUID();
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function booleanFlag(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function resolveAppEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const configured = env.APP_ENV?.trim();
  if (!configured) {
    if (env.NODE_ENV === 'production') return 'production';
    if (env.NODE_ENV === 'test') return 'test';
    return 'development';
  }
  if (configured === 'development' || configured === 'test' || configured === 'staging' || configured === 'production') {
    return configured;
  }
  throw new Error('APP_ENV must be development, test, staging, or production');
}

function loadHost(env: NodeJS.ProcessEnv, appEnv: AppEnvironment): string {
  const host = (env.HOST || (appEnv === 'staging' ? '127.0.0.1' : '0.0.0.0')).trim();
  const allowedHosts = new Set(['127.0.0.1', '::1', '0.0.0.0', '::']);
  if (!allowedHosts.has(host)) throw new Error('HOST must be one of 127.0.0.1, ::1, 0.0.0.0, or ::');
  if (appEnv === 'staging' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('HOST must use a loopback address when APP_ENV=staging');
  }
  return host;
}

/**
 * Resolves the auditable runtime switches used by the server process. Production
 * retains the historical all-interface listener and enabled background work;
 * staging defaults to loopback-only with TikTok and all background work disabled.
 */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const appEnv = resolveAppEnvironment(env);
  const tiktokIntegrationEnabled = booleanFlag(
    env.TIKTOK_INTEGRATION_ENABLED,
    appEnv !== 'staging',
    'TIKTOK_INTEGRATION_ENABLED',
  );
  const backgroundJobsEnabled = booleanFlag(
    env.BACKGROUND_JOBS_ENABLED,
    appEnv !== 'staging',
    'BACKGROUND_JOBS_ENABLED',
  );
  const metricsCronEnabled = backgroundJobsEnabled && booleanFlag(
    env.METRICS_CRON_ENABLED,
    true,
    'METRICS_CRON_ENABLED',
  );
  const reconciliationCronEnabled = backgroundJobsEnabled && tiktokIntegrationEnabled && booleanFlag(
    env.TIKTOK_RECONCILIATION_CRON_ENABLED,
    true,
    'TIKTOK_RECONCILIATION_CRON_ENABLED',
  );
  const startupReconciliationEnabled = reconciliationCronEnabled && booleanFlag(
    env.TIKTOK_STARTUP_RECONCILIATION_ENABLED,
    true,
    'TIKTOK_STARTUP_RECONCILIATION_ENABLED',
  );

  return {
    appEnv,
    host: loadHost(env, appEnv),
    port: positiveInt(env.PORT, appEnv === 'staging' ? 3300 : 3000, 'PORT'),
    tiktokIntegrationEnabled,
    backgroundJobsEnabled,
    metricsCronEnabled,
    reconciliationCronEnabled,
    startupReconciliationEnabled,
  };
}

function proxyHops(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed > 10) throw new Error('TRUST_PROXY_HOPS must be between 0 and 10');
  return parsed;
}

export function loadMediaConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const isTest = env.NODE_ENV === 'test';
  const signingSecret = env.MEDIA_SIGNING_SECRET || (isTest ? 'test-media-signing-secret-that-is-at-least-32-bytes' : '');
  if (Buffer.byteLength(signingSecret, 'utf8') < 32) throw new Error('MEDIA_SIGNING_SECRET must be at least 32 bytes');
  const publicBaseUrl = env.PUBLIC_BASE_URL || (isTest ? 'http://localhost:3000' : '');
  if (!publicBaseUrl) throw new Error('PUBLIC_BASE_URL must be configured');
  let parsed: URL;
  try { parsed = new URL(publicBaseUrl); } catch { throw new Error('PUBLIC_BASE_URL must be a valid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PUBLIC_BASE_URL must use http or https');
  return {
    root: path.resolve(env.MEDIA_ROOT || path.resolve(process.cwd(), 'uploads')),
    signingSecret,
    ttlSeconds: positiveInt(env.MEDIA_URL_TTL_SECONDS, 900, 'MEDIA_URL_TTL_SECONDS'),
    publicBaseUrl: parsed.origin,
    videoMaxBytes: positiveInt(env.UPLOAD_VIDEO_MAX_BYTES, 500 * 1024 * 1024, 'UPLOAD_VIDEO_MAX_BYTES'),
    imageMaxBytes: positiveInt(env.UPLOAD_IMAGE_MAX_BYTES, 20 * 1024 * 1024, 'UPLOAD_IMAGE_MAX_BYTES'),
  };
}

export function loadHttpSecurityConfig(env: NodeJS.ProcessEnv = process.env): HttpSecurityConfig {
  const rawOrigins = env.CORS_ALLOWED_ORIGINS || '';
  const allowedOrigins = [...new Set(rawOrigins.split(',').map((item) => item.trim()).filter(Boolean).map((origin) => {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('CORS_ALLOWED_ORIGINS contains an invalid origin'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('CORS_ALLOWED_ORIGINS must contain complete origins');
    return url.origin;
  }))];
  if (resolveAppEnvironment(env) === 'production' && !allowedOrigins.length) throw new Error('CORS_ALLOWED_ORIGINS must be configured in production');
  const trustProxyHops = proxyHops(env.TRUST_PROXY_HOPS);
  return {
    allowedOrigins,
    allowNullOrigin: env.CORS_ALLOW_NULL_ORIGIN === 'true',
    corsMaxAgeSeconds: positiveInt(env.CORS_MAX_AGE_SECONDS, 600, 'CORS_MAX_AGE_SECONDS'),
    trustProxyHops,
  };
}

export function loadOpsBrainBridgeConfig(env: NodeJS.ProcessEnv = process.env): OpsBrainBridgeConfig {
  const enabled = env.OPS_BRAIN_BRIDGE_ENABLED === 'true';
  if (!enabled) return { enabled: false };
  const token = env.OPS_BRAIN_BRIDGE_TOKEN || '';
  if (Buffer.byteLength(token, 'utf8') < 32) {
    throw new Error('OPS_BRAIN_BRIDGE_TOKEN must be at least 32 bytes when OPS_BRAIN_BRIDGE_ENABLED=true');
  }
  return { enabled: true, token };
}

export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  loadSecurityConfig(env);
  loadMediaConfig(env);
  loadHttpSecurityConfig(env);
  loadOpsBrainBridgeConfig(env);
  const runtime = loadRuntimeConfig(env);

  const databaseUrl = env.DATABASE_URL || '';
  if (!databaseUrl) throw new Error('DATABASE_URL must be configured');
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('Phase 1 uses SQLite migrations; DATABASE_URL must use the file: scheme');
  }
  if (runtime.appEnv === 'production' && (databaseUrl.includes(':memory:') || /(^|[/_.-])test([/_.-]|$)/iu.test(databaseUrl))) {
    throw new Error('Production DATABASE_URL must not point to an in-memory or test database');
  }

  if (runtime.tiktokIntegrationEnabled) {
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
      throw new Error('TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be configured when TIKTOK_INTEGRATION_ENABLED=true');
    }
    if (!env.TIKTOK_REDIRECT_URI) throw new Error('TIKTOK_REDIRECT_URI must be configured when TIKTOK_INTEGRATION_ENABLED=true');
    let redirect: URL;
    try {
      redirect = new URL(env.TIKTOK_REDIRECT_URI);
    } catch {
      throw new Error('TIKTOK_REDIRECT_URI must be a valid URL');
    }
    if (runtime.appEnv === 'production' && redirect.protocol !== 'https:') throw new Error('TIKTOK_REDIRECT_URI must use HTTPS in production');
  }

  return runtime;
}
