import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Prisma 7's SQLite migration engine requires the database file to exist.
 * Create it without truncating an existing harness database.
 */
export async function ensureHarnessDatabase(database: string): Promise<void> {
  await mkdir(path.dirname(database), { recursive: true });
  await writeFile(database, '', { flag: 'a', mode: 0o600 });
}
