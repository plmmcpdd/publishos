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
  if (env.NODE_ENV === 'production' && !allowedOrigins.length) throw new Error('CORS_ALLOWED_ORIGINS must be configured in production');
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

export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  loadSecurityConfig(env);
  loadMediaConfig(env);
  loadHttpSecurityConfig(env);
  loadOpsBrainBridgeConfig(env);

  const databaseUrl = env.DATABASE_URL || '';
  if (!databaseUrl) throw new Error('DATABASE_URL must be configured');
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('Phase 1 uses SQLite migrations; DATABASE_URL must use the file: scheme');
  }
  if (env.NODE_ENV === 'production' && (databaseUrl.includes(':memory:') || /(^|[/_.-])test([/_.-]|$)/iu.test(databaseUrl))) {
    throw new Error('Production DATABASE_URL must not point to an in-memory or test database');
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

  if (env.NODE_ENV === 'production') {
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
      throw new Error('TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be configured in production');
    }
    if (!env.TIKTOK_REDIRECT_URI) throw new Error('TIKTOK_REDIRECT_URI must be configured in production');
    let redirect: URL;
    try {
      redirect = new URL(env.TIKTOK_REDIRECT_URI);
    } catch {
      throw new Error('TIKTOK_REDIRECT_URI must be a valid URL');
    }
    if (redirect.protocol !== 'https:') throw new Error('TIKTOK_REDIRECT_URI must use HTTPS in production');
  }
}
