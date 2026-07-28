import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureHarnessDatabase } from './database';

describe('Ops Brain harness SQLite bootstrap', () => {
  it('creates a missing SQLite database before Prisma migration', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'publishos-harness-'));
    const database = path.join(directory, 'nested', 'harness.sqlite');
    try {
      await ensureHarnessDatabase(database);
      expect((await stat(database)).isFile()).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
