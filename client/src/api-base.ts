export const BACKEND_STORAGE_KEY = 'publishos_backend_url';
export const KNOWN_LEGACY_API_URLS = ['http://104.238.181.32:3000/v1'];
export const SESSION_STORAGE_KEYS = ['token', 'clientId', 'clientName'];

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function normalized(url: string): string {
  return url.trim().replace(/\/+$/u, '');
}

export function isKnownLegacyApiUrl(url: string): boolean {
  const candidate = normalized(url);
  return KNOWN_LEGACY_API_URLS.some((legacy) => normalized(legacy) === candidate);
}

export function clearClientSession(storage: StorageLike): void {
  SESSION_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
}

export function resolveApiBase(
  storage: StorageLike,
  buildUrl: string,
  fallbackUrl: string,
  logger: Pick<Console, 'info'> = console,
): { base: string; migrated: boolean } {
  const saved = storage.getItem(BACKEND_STORAGE_KEY);
  if (saved && isKnownLegacyApiUrl(saved)) {
    const target = normalized(buildUrl || fallbackUrl);
    storage.setItem(BACKEND_STORAGE_KEY, target);
    clearClientSession(storage);
    logger.info('PublishOS migrated a legacy Backend address; sign in to the current environment again.');
    return { base: target, migrated: true };
  }
  if (saved) return { base: normalized(saved), migrated: false };
  return { base: normalized(buildUrl || fallbackUrl), migrated: false };
}

export function backendHostname(base: string): string {
  try { return new URL(base).hostname; } catch { return 'invalid backend address'; }
}
