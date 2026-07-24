import type { Request, RequestHandler, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { getSecurityConfig, JWT_AUDIENCE, JWT_ISSUER } from '../config/security';
import { AppError } from './errors';

export type TokenType = 'admin' | 'client' | 'device' | 'task';
interface BaseAuth { sub: string; tokenType: TokenType; role: TokenType; jti: string; }
export interface AdminAuth extends BaseAuth { tokenType: 'admin'; role: 'admin'; }
export interface ClientAuth extends BaseAuth { tokenType: 'client'; role: 'client'; clientId: string; }
export interface DeviceAuth extends BaseAuth { tokenType: 'device'; role: 'device'; clientId: string; deviceId: string; }
export interface TaskAuth extends BaseAuth { tokenType: 'task'; role: 'task'; clientId: string; deviceId: string; jobId: string; }
export type AuthPrincipal = AdminAuth | ClientAuth | DeviceAuth | TaskAuth;

declare global { namespace Express { interface Request { auth?: AuthPrincipal; } } }
export type AuthRequest = Request;

function invalidToken(): never { throw new AppError(401, 'invalid_token', 'Invalid authentication token'); }

function principalFromPayload(payload: JwtPayload): AuthPrincipal {
  const { sub, jti, tokenType, role, exp, iat } = payload;
  if (
    typeof sub !== 'string' || !sub ||
    typeof jti !== 'string' || !jti ||
    typeof tokenType !== 'string' || role !== tokenType ||
    typeof exp !== 'number' || typeof iat !== 'number'
  ) invalidToken();
  if (tokenType === 'admin') return { sub, jti, tokenType, role: 'admin' };
  if (tokenType === 'client' && typeof payload.clientId === 'string' && payload.clientId === sub && payload.clientId) return { sub, jti, tokenType, role: 'client', clientId: payload.clientId };
  if (tokenType === 'device' && typeof payload.clientId === 'string' && payload.clientId && typeof payload.deviceId === 'string' && payload.deviceId === sub && payload.deviceId) return { sub, jti, tokenType, role: 'device', clientId: payload.clientId, deviceId: payload.deviceId };
  if (tokenType === 'task' && typeof payload.clientId === 'string' && payload.clientId && typeof payload.deviceId === 'string' && payload.deviceId && typeof payload.jobId === 'string' && payload.jobId === sub && payload.jobId) return { sub, jti, tokenType, role: 'task', clientId: payload.clientId, deviceId: payload.deviceId, jobId: payload.jobId };
  return invalidToken();
}

export const authenticateToken: RequestHandler = (req, _res, next) => {
  try {
    const value = req.header('authorization');
    if (!value?.startsWith('Bearer ')) throw new AppError(401, 'missing_token', 'Authentication is required');
    const { jwtSecret } = getSecurityConfig();
    const payload = jwt.verify(value.slice(7), jwtSecret, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE }) as JwtPayload;
    req.auth = principalFromPayload(payload);
    next();
  } catch (error) { next(error instanceof AppError ? error : new AppError(401, 'invalid_token', 'Invalid authentication token')); }
};

function requireType(type: TokenType): RequestHandler {
  return (req, _res, next) => req.auth?.tokenType === type ? next() : next(new AppError(403, 'forbidden', 'Insufficient permissions'));
}
export const requireAdmin = requireType('admin');
export const requireClient = requireType('client');
export const requireDevice = requireType('device');
export const requireTask = requireType('task');
export const authenticateUser = authenticateToken;
export const authenticateDevice = authenticateToken;
export const authenticateTaskToken = authenticateToken;

export function requireAdminOrClientSelf(target: (req: Request) => string | undefined): RequestHandler {
  return (req, _res, next) => {
    if (req.auth?.tokenType === 'admin') return next();
    if (req.auth?.tokenType !== 'client') return next(new AppError(403, 'forbidden', 'Insufficient permissions'));
    const supplied = target(req);
    if (supplied && supplied !== req.auth.clientId) return next(new AppError(403, 'tenant_mismatch', 'Tenant does not match token'));
    next();
  };
}

export function clientIdFromAuth(req: Request, supplied?: unknown): string | undefined {
  if (req.auth?.tokenType === 'admin') return typeof supplied === 'string' ? supplied : undefined;
  if (req.auth?.tokenType !== 'client') throw new AppError(403, 'forbidden', 'Insufficient permissions');
  if (typeof supplied === 'string' && supplied !== req.auth.clientId) throw new AppError(403, 'tenant_mismatch', 'Tenant does not match token');
  return req.auth.clientId;
}
