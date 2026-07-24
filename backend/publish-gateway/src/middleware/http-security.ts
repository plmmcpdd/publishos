import type { RequestHandler } from 'express';
import { AppError } from './errors';
import { loadHttpSecurityConfig } from '../config/security';

interface Bucket { count: number; resetAt: number; }
export class InMemoryRateLimitStore {
  private buckets = new Map<string, Bucket>();
  constructor(private readonly maxBuckets = 10_000) {}
  check(key: string, max: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfter: number } {
    for (const [item, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(item);
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      if (this.buckets.size >= this.maxBuckets) return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) };
      this.buckets.set(key, { count: 1, resetAt: now + windowMs }); return { allowed: true, retryAfter: 0 };
    }
    existing.count += 1;
    return { allowed: existing.count <= max, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  clear(): void { this.buckets.clear(); }
  get size(): number { return this.buckets.size; }
}

function configuredLimit(name: string, fallbackMax: number, fallbackWindowMs: number): { max: number; windowMs: number } {
  const prefix = `RATE_LIMIT_${name.toUpperCase()}_`;
  const parse = (value: string | undefined, fallback: number, label: string) => {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
    return parsed;
  };
  return { max: parse(process.env[`${prefix}MAX`], fallbackMax, `${prefix}MAX`), windowMs: parse(process.env[`${prefix}WINDOW_MS`], fallbackWindowMs, `${prefix}WINDOW_MS`) };
}

export function corsSecurity(): RequestHandler {
  return (req, res, next) => {
    try {
      const config = loadHttpSecurityConfig(); const origin = req.header('origin');
      if (origin) {
        let normalizedOrigin: string | undefined;
        if (origin !== 'null') {
          try { const parsed = new URL(origin); if (parsed.origin === origin || parsed.origin.toLowerCase() === origin.toLowerCase()) normalizedOrigin = parsed.origin; } catch { /* denied below */ }
        }
        const allowed = origin === 'null' ? config.allowNullOrigin : !!normalizedOrigin && config.allowedOrigins.includes(normalizedOrigin);
        if (!allowed) throw new AppError(403, 'cors_origin_denied', 'Origin is not allowed');
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
        res.setHeader('Access-Control-Max-Age', String(config.corsMaxAgeSeconds));
        if (req.method === 'OPTIONS') { res.status(204).end(); return; }
      }
      next();
    } catch (error) { next(error); }
  };
}

export function rateLimit(name: string, max: number, windowMs: number, store = defaultRateLimitStore): RequestHandler {
  return (req, res, next) => {
    const configured = configuredLimit(name, max, windowMs);
    const identity = req.auth?.sub ? `actor:${req.auth.sub}` : `ip:${req.ip}`;
    const result = store.check(`${name}:${identity}`, configured.max, configured.windowMs);
    if (!result.allowed) { res.setHeader('Retry-After', String(result.retryAfter)); return next(new AppError(429, 'rate_limit_exceeded', 'Too many requests')); }
    next();
  };
}
export const defaultRateLimitStore = new InMemoryRateLimitStore();
