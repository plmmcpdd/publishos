import 'dotenv/config';
import cron from 'node-cron';
import { createApp } from './app';
import { validateRuntimeConfig } from './config/security';
import { prisma } from './lib/prisma';
import { collectAllMetrics } from './services/metrics-collector';
import { reconcileTikTokJobs } from './services/publisher';

validateRuntimeConfig();
const app = createApp();
const port = Number(process.env.PORT || 3000);
let shuttingDown = false;

const metricsTask = cron.schedule('0 2 * * *', async () => {
  try {
    await collectAllMetrics();
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'metrics_collection_failed' }));
  }
});

const reconciliationTask = cron.schedule('* * * * *', async () => {
  try {
    const result = await reconcileTikTokJobs();
    if (result.rejected) {
      console.error(JSON.stringify({ level: 'warn', event: 'tiktok_reconciliation_partial_failure', ...result }));
    }
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'tiktok_reconciliation_failed' }));
  }
});

const server = app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', event: 'server_listening', port }));
  setImmediate(() => {
    void reconcileTikTokJobs().catch(() => {
      console.error(JSON.stringify({ level: 'error', event: 'tiktok_startup_reconciliation_failed' }));
    });
  });
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', event: 'server_shutdown_started', signal }));
  metricsTask.stop();
  reconciliationTask.stop();
  const forced = setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', event: 'server_shutdown_timeout' }));
    process.exitCode = 1;
  }, 10_000);
  forced.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  clearTimeout(forced);
  console.log(JSON.stringify({ level: 'info', event: 'server_shutdown_complete' }));
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
