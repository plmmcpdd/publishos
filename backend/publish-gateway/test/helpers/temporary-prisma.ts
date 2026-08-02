import { closeSync, existsSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Boot a disposable migrated SQLite database. This is intentionally not a
 * fallback: Prisma migration failure is fatal to the caller's test suite.
 */
export function createTemporaryPrismaDatabase(prefix: string, gatewayRoot: string) {
  const directory = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const database = path.resolve(directory, 'gateway.db');
  const databaseUrl = `file:${database}`;
  const prismaCli = path.join(gatewayRoot, 'node_modules', '.bin', 'prisma');

  if (!path.isAbsolute(database) || !database.startsWith(`${directory}${path.sep}`) || database.startsWith('/var/lib/')) {
    throw new Error('Test database must be an absolute path inside its temporary directory');
  }
  if (!databaseUrl || databaseUrl === 'file:' || databaseUrl.includes('..')) throw new Error('Unsafe test database URL');

  return {
    directory,
    database,
    databaseUrl,
    async migrate() {
      // Prisma 7 returns P1003 for a missing SQLite file, so create it before
      // migrate deploy. Production deployment deliberately does not do this.
      closeSync(openSync(database, 'w'));
      if (!existsSync(database)) throw new Error('Test SQLite file was not created before migration');
      await execFileAsync(prismaCli, ['migrate', 'deploy', '--config', './prisma.config.ts'], {
        cwd: gatewayRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        maxBuffer: 10 * 1024 * 1024,
      });
    },
    cleanup() { rmSync(directory, { recursive: true, force: true }); },
  };
}
