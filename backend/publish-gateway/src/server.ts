import 'dotenv/config';
import type { Server } from 'node:http';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { createApp } from './app';
import { type RuntimeConfig, validateRuntimeConfig } from './config/security';
import { prisma } from './lib/prisma';
import { collectAllMetrics } from './services/metrics-collector';
import { reconcileTikTokJobs } from './services/publisher';

type Log = (entry: Record<string, unknown>) => void;
type CronTask = Pick<ScheduledTask, 'stop'>;

interface ListenableApp {
  listen(port: number, host: string, callback: () => void): Server;
}

export interface RuntimeDependencies {
  createApp: () => ListenableApp;
  schedule: (expression: string, handler: () => Promise<void>) => CronTask;
  collectAllMetrics: () => Promise<void>;
  reconcileTikTokJobs: () => Promise<{ selected: number; fulfilled: number; rejected: number }>;
  disconnectDatabase: () => Promise<void>;
  log: Log;
  error: Log;
}

export interface RunningServer {
  server: Server;
  runtime: RuntimeConfig;
  shutdown: (signal: string) => Promise<void>;
}

function jsonLog(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}

function jsonError(entry: Record<string, unknown>): void {
  console.error(JSON.stringify(entry));
}

const defaultDependencies: RuntimeDependencies = {
  createApp,
  schedule: (expression, handler) => cron.schedule(expression, handler),
  collectAllMetrics,
  reconcileTikTokJobs,
  disconnectDatabase: () => prisma.$disconnect(),
  log: jsonLog,
  error: jsonError,
};

/** Start the HTTP process after validating all runtime switches. */
export function startServer(options: {
  env?: NodeJS.ProcessEnv;
  dependencies?: RuntimeDependencies;
  installSignalHandlers?: boolean;
} = {}): RunningServer {
  const env = options.env ?? process.env;
  const dependencies = options.dependencies ?? defaultDependencies;
  const runtime = validateRuntimeConfig(env);
  const app = dependencies.createApp();
  let shuttingDown = false;
  let metricsTask: CronTask | undefined;
  let reconciliationTask: CronTask | undefined;

  if (runtime.metricsCronEnabled) {
    metricsTask = dependencies.schedule('0 2 * * *', async () => {
      try {
        await dependencies.collectAllMetrics();
      } catch {
        dependencies.error({ level: 'error', event: 'metrics_collection_failed' });
      }
    });
    dependencies.log({ level: 'info', event: 'metrics_cron_enabled' });
  } else {
    dependencies.log({ level: 'info', event: 'metrics_cron_disabled' });
  }

  if (runtime.reconciliationCronEnabled) {
    reconciliationTask = dependencies.schedule('* * * * *', async () => {
      try {
        const result = await dependencies.reconcileTikTokJobs();
        if (result.rejected) dependencies.error({ level: 'warn', event: 'tiktok_reconciliation_partial_failure', ...result });
      } catch {
        dependencies.error({ level: 'error', event: 'tiktok_reconciliation_failed' });
      }
    });
    dependencies.log({ level: 'info', event: 'tiktok_reconciliation_cron_enabled' });
  } else {
    dependencies.log({ level: 'info', event: 'tiktok_reconciliation_cron_disabled' });
  }

  const server = app.listen(runtime.port, runtime.host, () => {
    dependencies.log({ level: 'info', event: 'server_listening', appEnv: runtime.appEnv, host: runtime.host, port: runtime.port });
    if (!runtime.startupReconciliationEnabled) {
      dependencies.log({ level: 'info', event: 'tiktok_startup_reconciliation_disabled' });
      return;
    }
    setImmediate(() => {
      void dependencies.reconcileTikTokJobs().catch(() => {
        dependencies.error({ level: 'error', event: 'tiktok_startup_reconciliation_failed' });
      });
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    dependencies.log({ level: 'info', event: 'server_shutdown_started', signal });
    metricsTask?.stop();
    reconciliationTask?.stop();
    const forced = setTimeout(() => {
      dependencies.error({ level: 'error', event: 'server_shutdown_timeout' });
      process.exitCode = 1;
    }, 10_000);
    forced.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await dependencies.disconnectDatabase();
    clearTimeout(forced);
    dependencies.log({ level: 'info', event: 'server_shutdown_complete' });
  };

  if (options.installSignalHandlers !== false) {
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT', () => { void shutdown('SIGINT'); });
  }

  return { server, runtime, shutdown };
}

if (require.main === module) startServer();
