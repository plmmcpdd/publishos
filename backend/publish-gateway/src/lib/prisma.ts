import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL must be configured before Prisma is imported');

const adapter = databaseUrl.startsWith('file:')
  ? new PrismaBetterSqlite3({ url: databaseUrl })
  : new PrismaPg({ connectionString: databaseUrl });

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' && process.env.PRISMA_LOG_QUERIES === 'true'
    ? ['query', 'info', 'warn', 'error']
    : ['warn', 'error'],
});
