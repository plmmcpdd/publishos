import crypto from 'crypto';
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly message: string,
  ) {
    super(message);
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  res.locals.requestId = req.header('x-request-id') || crypto.randomUUID();
  res.setHeader('x-request-id', res.locals.requestId);
  next();
};

export function sendInternalError(req: Request, res: Response): void {
  console.error(JSON.stringify({ requestId: res.locals.requestId, status: 500, code: 'internal_error', actorType: req.auth?.tokenType, resource: req.path }));
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error', requestId: res.locals.requestId } });
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = res.locals.requestId || crypto.randomUUID();
  const appError = err instanceof AppError ? err : undefined;
  const uniqueConstraint = !appError && (err as { code?: unknown })?.code === 'P2002';
  const status = appError?.status || (uniqueConstraint ? 409 : 500);
  const code = appError?.code || (uniqueConstraint ? 'conflict' : 'internal_error');
  const message = appError?.message || (uniqueConstraint ? 'A record with that value already exists' : 'Internal server error');
  console.error(JSON.stringify({ requestId, status, code, actorType: req.auth?.tokenType, resource: req.path }));
  res.status(status).json({ error: { code, message, requestId } });
};
