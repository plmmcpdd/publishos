import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsRoot = path.join(root, 'prisma', 'migrations');
const migrationNames = [
  '0_init',
  '20260724000000_phase1c_oauth_state',
  '20260725000000_phase1d_tiktok_draft_delivery',
  '20260725081106_phase2a_platform_data_return',
  '20260727000000_ops_brain_content_ref',
  '20260802000000_account_targeted_content_delivery',
  '20260802120000_mobile_caption_handoff',
];
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'publishos-mobile-handoff-migration-'));
  directories.push(directory);
  const database = new Database(path.join(directory, 'gateway.db'));
  database.pragma('foreign_keys = ON');
  return database;
}

function apply(database: Database.Database, name: string) {
  database.exec(readFileSync(path.join(migrationsRoot, name, 'migration.sql'), 'utf8'));
}

describe('MobileCaptionHandoff additive migration', () => {
  it('applies successfully to a fresh temporary SQLite database', () => {
    const database = fixture();
    for (const name of migrationNames) apply(database, name);
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='MobileCaptionHandoff'").get();
    const indexes = database.prepare("PRAGMA index_list('MobileCaptionHandoff')").all() as Array<{ name: string }>;
    expect(table).toEqual({ name: 'MobileCaptionHandoff' });
    expect(indexes.map(({ name }) => name)).toContain('MobileCaptionHandoff_tokenHash_key');
    database.close();
  });

  it('upgrades an old database without modifying existing Client or Content rows', () => {
    const database = fixture();
    for (const name of migrationNames.slice(0, -1)) apply(database, name);
    const now = '2026-08-02T00:00:00.000Z';
    database.prepare('INSERT INTO "Client" ("id","name","email","password","createdAt","updatedAt") VALUES (?,?,?,?,?,?)')
      .run('client-existing', 'Existing client', 'existing@example.test', 'password-fixture', now, now);
    database.prepare('INSERT INTO "Content" ("id","clientId","title","description","caption","hashtags","videoUrl","platforms","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run('content-existing', 'client-existing', 'Existing title', 'Existing description', 'Existing caption', '["existing"]', 'fixture/video.mp4', '["tiktok"]', 'delivered', now, now);
    const beforeClient = database.prepare('SELECT * FROM "Client" WHERE "id"=?').get('client-existing');
    const beforeContent = database.prepare('SELECT * FROM "Content" WHERE "id"=?').get('content-existing');

    apply(database, migrationNames.at(-1)!);

    expect(database.prepare('SELECT * FROM "Client" WHERE "id"=?').get('client-existing')).toEqual(beforeClient);
    expect(database.prepare('SELECT * FROM "Content" WHERE "id"=?').get('content-existing')).toEqual(beforeContent);
    expect(database.prepare('SELECT count(*) AS count FROM "MobileCaptionHandoff"').get()).toEqual({ count: 0 });
    database.close();
  });
});
