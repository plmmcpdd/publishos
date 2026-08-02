import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveApiBase } from '../src/api-base.ts';

test('defaults to the same-origin API path when VITE_API_URL is unset', () => {
  assert.equal(resolveApiBase(), '/v1');
});

test('preserves an explicitly configured VITE_API_URL', () => {
  assert.equal(resolveApiBase('https://api.example.test/v1'), 'https://api.example.test/v1');
});

test('dashboard source does not contain the legacy localhost API base', async () => {
  const apiSource = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
  const baseSource = await readFile(new URL('../src/api-base.ts', import.meta.url), 'utf8');
  const monitorSource = await readFile(new URL('../src/pages/Monitor.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(apiSource, /http:\/\/localhost:3000\/v1/);
  assert.doesNotMatch(baseSource, /http:\/\/localhost:3000\/v1/);
  assert.doesNotMatch(monitorSource, /localhost:3000/);
  assert.match(baseSource, /['"]\/v1['"]/);
});
