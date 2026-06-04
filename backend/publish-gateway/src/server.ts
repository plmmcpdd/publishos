import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import contentRoutes from './routes/content';
import publishJobRoutes from './routes/publish-jobs';
import clientRoutes from './routes/client';
import taskRoutes from './routes/tasks';
import auditRoutes from './routes/audit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// API routes
app.use('/v1/content', contentRoutes);
app.use('/v1/publish-jobs', publishJobRoutes);
app.use('/v1/client', clientRoutes);
app.use('/v1/tasks', taskRoutes);
app.use('/v1/audit', auditRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Publish Gateway listening on port ${PORT}`);
});
