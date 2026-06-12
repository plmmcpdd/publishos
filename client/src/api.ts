export const api = {
  base: import.meta.env.VITE_API_URL || 'http://localhost:3000/v1',
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
  postUrl?: string;
}

export interface ClientSession {
  token: string;
  client: {
    id: string;
    name: string;
    industry?: string;
  };
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
  platformPostUrl?: string | null;
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
    postUrl: item.platformPostUrl || undefined,
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
      message = data.error || message;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
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

export async function confirmContent(id: string): Promise<ContentItem> {
  const data = await request<{ success: boolean; data: ApiContent }>(`/content/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ clientId: requireClientId(), deviceId: requireDeviceId() }),
  });
  return mapContent(data.data);
}

export async function fetchClientHistory(): Promise<ContentItem[]> {
  const clientId = requireClientId();
  const data = await request<{ success: boolean; data: ApiContent[] }>(
    `/content?clientId=${encodeURIComponent(clientId)}`,
  );
  return data.data.map(mapContent).filter((item) => item.status === 'published' || item.status === 'rejected');
}
