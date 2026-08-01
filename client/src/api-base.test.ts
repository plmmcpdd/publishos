import { describe, expect, it, vi } from 'vitest';
import { BACKEND_STORAGE_KEY, resolveApiBase } from './api-base';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    value: (key: string) => values.get(key),
  };
}

describe('Backend URL migration', () => {
  const staging = 'https://publishos-staging.zn-con.com/v1';

  it('migrates a known legacy server and clears the old login session', () => {
    const storage = memoryStorage({
      [BACKEND_STORAGE_KEY]: 'http://104.238.181.32:3000/v1/',
      token: 'old-session', clientId: 'old-client', clientName: 'Old Client',
    });
    const logger = { info: vi.fn() };
    expect(resolveApiBase(storage, staging, 'http://localhost:3000/v1', logger)).toEqual({ base: staging, migrated: true });
    expect(storage.value(BACKEND_STORAGE_KEY)).toBe(staging);
    expect(storage.value('token')).toBeUndefined();
    expect(storage.value('clientId')).toBeUndefined();
    expect(storage.value('clientName')).toBeUndefined();
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it('keeps the build-time server when there is no saved override', () => {
    const storage = memoryStorage();
    expect(resolveApiBase(storage, staging, 'http://localhost:3000/v1').base).toBe(staging);
  });

  it('does not overwrite an unknown custom server', () => {
    const custom = 'https://custom.example.test/v1';
    const storage = memoryStorage({ [BACKEND_STORAGE_KEY]: custom, token: 'session' });
    expect(resolveApiBase(storage, staging, 'http://localhost:3000/v1')).toEqual({ base: custom, migrated: false });
    expect(storage.value('token')).toBe('session');
  });
});
