import { defineConfig } from 'vitest/config';

// The integration suites each invoke Prisma CLI against a temporary SQLite
// database. Prisma 7 client generation/schema initialization is process-global
// enough to contend when those suites start concurrently, causing beforeAll
// timeouts. Unit work remains fast; database suites are deliberately serialized.
export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ['./test/setup/no-network.ts'],
    hookTimeout: 60_000,
  },
});
