import { readFile } from 'node:fs/promises';

export interface HarnessFixture {
  schemaVersion: 1;
  contentRef: string;
  clients: Array<{ id: string; name: string; email: string }>;
}

export async function loadFixture(path: string): Promise<HarnessFixture> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('fixture must be an object');
  const value = parsed as Partial<HarnessFixture>;
  if (value.schemaVersion !== 1 || typeof value.contentRef !== 'string' || !Array.isArray(value.clients) || value.clients.length !== 2) {
    throw new Error('fixture is invalid');
  }
  for (const client of value.clients) {
    if (!client || typeof client.id !== 'string' || typeof client.name !== 'string' || typeof client.email !== 'string') {
      throw new Error('fixture client is invalid');
    }
  }
  return value as HarnessFixture;
}
