import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const forbiddenApiBase = 'http://localhost:3000/v1';
const expectedApiBase = '/v1';

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    if (entry.isFile()) files.push(path);
  }

  return files;
}

const files = await filesUnder(distDir);
let expectedFound = false;

for (const file of files) {
  const contents = await readFile(file);
  const displayName = relative(distDir, file);

  if (contents.includes(Buffer.from(forbiddenApiBase))) {
    console.error(`Dashboard artifact guard failed: forbidden API base found in ${displayName}`);
    process.exitCode = 1;
  }

  if (contents.includes(Buffer.from(expectedApiBase))) expectedFound = true;
}

if (!expectedFound) {
  console.error('Dashboard artifact guard failed: expected same-origin API base was not found');
  process.exitCode = 1;
}

if (!process.exitCode) console.log('Dashboard artifact API base guard passed');
