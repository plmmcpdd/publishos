// ---- Server URL management ----
// ⚠️ CHANGE THIS when deploying to a new server:
const DEFAULT_SERVER = 'http://104.238.181.32:3000/v1';
// Priority: localStorage (Settings page) > build-time VITE_API_URL > DEFAULT_SERVER > auto-detect > fallback
const STORAGE_KEY = 'publishos_backend_url';
const BUILD_URL = import.meta.env.VITE_API_URL || '';

function getApiBase(): string {
  // 1. User-configured URL (from Settings page)
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return saved;
  // 2. Build-time URL (VITE_API_URL)
  if (BUILD_URL) return BUILD_URL;
  // 3. Hardcoded default server
  return DEFAULT_SERVER;
}

export const api = {
  get base() { return getApiBase(); },
  setBase(url: string) { localStorage.setItem(STORAGE_KEY, url); },
  resetBase() { localStorage.removeItem(STORAGE_KEY); },
};

export interface ContentItem {
  id: string;
  title: string;
  description?: string;
  platform: string;
  platforms?: string;
  scheduledAt: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  videoUrl?: string;
  postUrl?: string;
  publishError?: string | null;
  publishJobStatus?: string | null;
}

export interface ClientSession {
  token: string;
  client: {
    id: string;
    name: string;
    industry?: string;
  };
}

export interface ConfirmContentResult {
  content: ContentItem;
  publishing: boolean;
  publishJobId?: string | null;
  message?: string;
}

interface ApiContent {
  id: string;
  title: string;
  description?: string;
  platforms?: string;
  platform?: string;
  scheduleAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  status: string;
  thumbnailUrl?: string | null;
  thumbnail_url?: string | null;
  videoUrl?: string | null;
  platformPostUrl?: string | null;
  publishError?: string | null;
  publishJobStatus?: string | null;
}

function firstPlatform(value?: string) {
  if (!value) return 'tiktok';
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed[0] ? String(parsed[0]) : value;
  } catch {
    return value;
  }
}

function mapContent(item: ApiContent): ContentItem {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    platform: item.platform || firstPlatform(item.platforms),
    platforms: item.platforms,
    scheduledAt: item.scheduleAt || item.updatedAt || item.createdAt || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    status: item.status,
    thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || undefined,
    thumbnail_url: item.thumbnail_url || undefined,
    videoUrl: item.videoUrl || undefined,
    postUrl: item.platformPostUrl || undefined,
    publishError: item.publishError || null,
    publishJobStatus: item.publishJobStatus || null,
  };
}

function requireClientId() {
  const clientId = localStorage.getItem('clientId');
  if (!clientId) throw new Error('Please sign in again');
  return clientId;
}

function requireDeviceId() {
  let deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    deviceId = `device-${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem('deviceId', deviceId);
  }
  return deviceId;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${api.base}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `API ${response.status}`;
    try {
      const data = await response.json();
      message = typeof data.error === 'string' ? data.error : data.error?.message || message;
    } catch {
      // Keep the status-based message.
    }
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('clientId');
      localStorage.removeItem('clientName');
      window.dispatchEvent(new Event('publishos-client-session-expired'));
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

// ---- Public API ----

export async function checkServerConnection(): Promise<{ ok: boolean; url: string }> {
  try {
    const res = await fetch(`${api.base}/../health`.replace('/v1/../', '/'), { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return { ok: data.status === 'ok', url: api.base };
  } catch {
    return { ok: false, url: api.base };
  }
}

export async function loginClient(email: string, password: string): Promise<ClientSession> {
  const data = await request<{ success: boolean; data: ClientSession; error?: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!data.success) {
    throw new Error(data.error || 'Login failed');
  }
  return data.data;
}

export async function fetchDeliveredContents(): Promise<ContentItem[]> {
  const clientId = requireClientId();
  const data = await request<{ success: boolean; data: ApiContent[] }>(
    `/content/delivered?clientId=${encodeURIComponent(clientId)}`,
  );
  return data.data.map(mapContent);
}

export async function confirmContent(id: string): Promise<ConfirmContentResult> {
  const data = await request<{
    success: boolean;
    data: ApiContent & { publishing?: boolean; publishJobId?: string | null; message?: string };
  }>(`/content/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ clientId: requireClientId(), deviceId: requireDeviceId() }),
  });
  return {
    content: mapContent(data.data),
    publishing: Boolean(data.data.publishing),
    publishJobId: data.data.publishJobId,
    message: data.data.message,
  };
}

export async function fetchClientHistory(): Promise<ContentItem[]> {
  const clientId = requireClientId();
  const data = await request<{ success: boolean; data: ApiContent[] }>(
    `/content?clientId=${encodeURIComponent(clientId)}`,
  );
  return data.data.map(mapContent).filter((item) => item.status === 'published' || item.status === 'rejected' || item.status === 'failed');
}

// ---- TikTok binding ----

export interface TikTokBinding {
  id: string;
  platform: string;
  accountUsername: string;
  username: string;
  displayName?: string;
  platformUserId?: string;
  openId?: string;
  status: string;
  active: boolean;
}

export async function fetchTikTokBindings(): Promise<TikTokBinding[]> {
  const clientId = requireClientId();
  const data = await request<{ success: boolean; data: TikTokBinding[] }>(
    `/tiktok/bindings/${encodeURIComponent(clientId)}`,
  );
  return data.data;
}

export async function getTikTokAuthUrl(): Promise<string> {
  const clientId = requireClientId();
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    `/tiktok/auth?clientId=${encodeURIComponent(clientId)}`,
  );
  return data.data.authUrl;
}

export async function exchangeTikTokCode(code: string, _state: string): Promise<{ username: string }> {
  const clientId = requireClientId();
  const data = await request<{ success: boolean; data: { username: string } }>(
    '/tiktok/exchange',
    {
      method: 'POST',
      body: JSON.stringify({ code, clientId }),
    },
  );
  return data.data;
}

export async function disconnectTikTokBinding(id: string): Promise<void> {
  await request(`/tiktok/bindings/${id}`, { method: 'DELETE' });
}
