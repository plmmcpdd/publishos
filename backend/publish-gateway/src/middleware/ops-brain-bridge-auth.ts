import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { loadOpsBrainBridgeConfig } from '../config/security';
import { AppError } from './errors';

export function constantTimeTokenEquals(actual: string, expected: string): boolean {
  // Fixed-size digests make the comparison independent of either token's length.
  const actualDigest = crypto.createHash('sha256').update(actual, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

export const authenticateOpsBrainBridge: RequestHandler = (req, _res, next) => {
  try {
    const config = loadOpsBrainBridgeConfig();
    if (!config.enabled || !config.token) throw new AppError(404, 'not_found', 'Not found');
    const authorization = req.header('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new AppError(401, 'ops_brain_unauthorized', 'Authentication is required');
    const supplied = authorization.slice(7);
    if (!supplied || !constantTimeTokenEquals(supplied, config.token)) {
      throw new AppError(401, 'ops_brain_unauthorized', 'Authentication is required');
    }
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(404, 'not_found', 'Not found'));
  }
};
