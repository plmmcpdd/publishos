import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.DATABASE_URL;

const adapter = databaseUrl?.startsWith('file:')
  ? new PrismaBetterSqlite3({ url: databaseUrl })
  : new PrismaPg({ connectionString: databaseUrl });

export const prisma = new PrismaClient({
  adapter,
  log: ['query', 'info', 'warn', 'error'],
});
