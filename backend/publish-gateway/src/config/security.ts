import crypto from 'crypto';
import type { SignOptions } from 'jsonwebtoken';

export const JWT_ISSUER = 'publishos';
export const JWT_AUDIENCE = 'publishos-api';

export interface SecurityConfig {
  jwtSecret: string;
  jwtOptions: Pick<SignOptions, 'algorithm' | 'issuer' | 'audience'>;
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
