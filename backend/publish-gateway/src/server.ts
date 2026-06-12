import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import contentRoutes from './routes/content';
import authRoutes from './routes/auth';
import publishJobRoutes from './routes/publish-jobs';
import clientRoutes from './routes/client';
import taskRoutes from './routes/tasks';
import auditRoutes from './routes/audit';
import apiContentRoutes from './routes/api-contents';
import statsRoutes from './routes/stats';
import auditLogRoutes from './routes/audit-logs';
import { languageMiddleware } from './middleware/language';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(languageMiddleware);

// Health check
app.get('/health', (_req, res) => {
  const mode = process.env.DATABASE_URL?.startsWith('file:') ? 'mock-sqlite' : 'postgres';
  res.json({ status: 'ok', version: '0.1.0', mode });
});

// API routes
app.use('/v1/auth', authRoutes);
app.use('/v1/content', contentRoutes);
app.use('/v1/publish-jobs', publishJobRoutes);
app.use('/v1/client', clientRoutes);
app.use('/v1/tasks', taskRoutes);
app.use('/v1/audit', auditRoutes);
app.use('/v1/stats', statsRoutes);
app.use('/v1/audit-logs', auditLogRoutes);
app.use('/api/v1/contents', apiContentRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1/audit-logs', auditLogRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: res.locals.t('errors.notFound') });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: res.locals.t('errors.internal') });
});

app.listen(PORT, () => {
  console.log(`Publish Gateway listening on port ${PORT}`);
});
