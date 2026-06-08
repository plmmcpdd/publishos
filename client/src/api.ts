export interface ContentItem {
  id: string;
  title: string;
  platform: string;
  scheduledAt: string;
  status: string;
  postUrl?: string;
}

const API_BASE = 'http://localhost:3000/api/v1';

interface ApiContent {
  id: string;
  title: string;
  platforms?: string;
  platform?: string;
  scheduleAt?: string | null;
  updatedAt?: string;
  publishedAt?: string | null;
  status: string;
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
    platform: item.platform || firstPlatform(item.platforms),
    scheduledAt: item.scheduleAt || item.publishedAt || item.updatedAt || '',
    status: item.status,
    postUrl: item.platformPostUrl || undefined,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchContents(status: string): Promise<ContentItem[]> {
  const data = await request<{ data: ApiContent[] }>(`/contents?status=${encodeURIComponent(status)}`);
  return data.data.map(mapContent);
}

export async function publishContent(id: string): Promise<ContentItem> {
  const data = await request<{ data: ApiContent }>(`/contents/${id}/publish`, { method: 'POST' });
  return mapContent(data.data);
}
