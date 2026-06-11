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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api.base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchDeliveredContents(clientId: string): Promise<ContentItem[]> {
  const data = await request<{ success: boolean; data: ApiContent[] }>(`/content/delivered?clientId=${encodeURIComponent(clientId)}`);
  return data.data.map(mapContent);
}

export async function confirmContent(id: string): Promise<ContentItem> {
  const data = await request<{ success: boolean; data: ApiContent }>(`/content/${id}/confirm`, { method: 'POST' });
  return mapContent(data.data);
}

export async function fetchClientHistory(clientId: string): Promise<ContentItem[]> {
  const data = await request<{ success: boolean; data: ApiContent[] }>(`/content?clientId=${encodeURIComponent(clientId)}`);
  return data.data.map(mapContent).filter((item) => item.status === 'published' || item.status === 'rejected');
}
