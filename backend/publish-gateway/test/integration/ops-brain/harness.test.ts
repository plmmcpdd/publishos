import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixture } from './fixture';

describe('Ops Brain local harness fixture', () => {
  it('contains only the required fictional cross-tenant identity', async () => {
    const fixture = await loadFixture(path.join(import.meta.dirname, 'fixture.json'));
    expect(fixture.contentRef).toBe('2026-07-20_aaaaaaaaaaaa_example');
    expect(fixture.clients.map((client) => client.id)).toEqual(['example-client-a', 'example-client-b']);
    expect(fixture.clients.every((client) => client.email.endsWith('.test'))).toBe(true);
  });
});
