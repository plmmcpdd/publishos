import express from 'express';
import cors from 'cors';
import path from 'path';
import contentRoutes from './routes/content';
import authRoutes from './routes/auth';
import uploadRoutes from './routes/upload';
import publishJobRoutes from './routes/publish-jobs';
import clientRoutes from './routes/client';
import taskRoutes from './routes/tasks';
import auditRoutes from './routes/audit';
import apiContentRoutes from './routes/api-contents';
import statsRoutes from './routes/stats';
import auditLogRoutes from './routes/audit-logs';
import tiktokRoutes from './routes/tiktok';
import metricsRoutes from './routes/metrics';
import ticketRoutes from './routes/tickets';
import { languageMiddleware } from './middleware/language';
import { errorHandler, requestId } from './middleware/errors';
import { initializeSecurityConfig } from './config/security';
import { authenticateToken, requireAdmin } from './middleware/auth';

const deprecated = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</v1>; rel="successor-version"');
  next();
};

export function createApp() {
  initializeSecurityConfig();
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(requestId);
  app.use(languageMiddleware);
  app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));
  app.get('/health', (_req, res) => res.json({ status: 'ok', version: '0.1.0' }));
  app.use('/v1/auth', authRoutes);
  app.use('/v1', tiktokRoutes);
  app.use('/v1', uploadRoutes);
  app.use('/v1/content', contentRoutes);
  app.use('/v1/publish-jobs', publishJobRoutes);
  app.use('/v1/client', clientRoutes);
  app.use('/v1/tasks', taskRoutes);
  app.use('/v1/audit', auditRoutes);
  app.use('/v1/stats', statsRoutes);
  app.use('/v1', metricsRoutes);
  app.use('/v1/audit-logs', auditLogRoutes);
  app.use('/v1', authenticateToken, requireAdmin, ticketRoutes);
  app.use('/api/v1', deprecated);
  app.use('/api/v1/contents', apiContentRoutes);
  app.use('/api/v1/stats', statsRoutes);
  app.use('/api/v1', metricsRoutes);
  app.use('/api/v1/audit-logs', auditLogRoutes);
  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found', requestId: res.locals.requestId } }));
  app.use(errorHandler);
  return app;
}
