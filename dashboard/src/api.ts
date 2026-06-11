export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/v1';

export const api = {
  base: API_BASE,
};

export interface Stats {
  todayPublished: number;
  pending: number;
  totalCustomers: number;
  failed: number;
}

export interface ContentItem {
  id: string;
  title: string;
  description?: string;
  platform?: string;
  platforms?: string;
  status: string;
  clientId?: string;
  client?: {
    id: string;
    name: string;
  };
  createdAt?: string;
  updatedAt?: string;
  thumbnail_url?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
}

export interface Client {
  id: string;
  name: string;
  industry?: string | null;
  active: boolean;
}

export interface AuditLog {
  id: string;
  action: string;
  actorId: string;
  actorType: string;
  targetType: string;
  targetId: string;
  details?: string | null;
  createdAt: string;
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

export function firstPlatform(item: ContentItem): string {
  const value = item.platform || item.platforms;
  if (!value) return 'TikTok';
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed[0] ? String(parsed[0]) : value;
  } catch {
    return value;
  }
}

export async function fetchStats(): Promise<Stats> {
  return request<Stats>('/stats');
}

export async function fetchContents(status?: string): Promise<ContentItem[]> {
  const query = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
  const data = await request<{ success?: boolean; data: ContentItem[] }>(`/content${query}`);
  return data.data;
}

export async function approveContent(id: string): Promise<void> {
  await request(`/content/${id}/approve`, { method: 'POST' });
}

export async function rejectContent(id: string): Promise<void> {
  await request(`/content/${id}/reject`, { method: 'POST' });
}

export async function deliverContent(id: string): Promise<void> {
  await request(`/content/${id}/deliver`, { method: 'POST' });
}

export async function deleteContent(id: string): Promise<void> {
  await request(`/content/${id}`, { method: 'DELETE' });
}

export async function createContent(input: {
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl?: string;
  platform: string;
  clientId: string;
}): Promise<ContentItem> {
  const data = await request<{ success: boolean; data: ContentItem }>('/content', {
    method: 'POST',
    body: JSON.stringify({ ...input, status: 'draft' }),
  });

  return data.data;
}

export async function fetchClients(): Promise<Client[]> {
  const data = await request<{ success?: boolean; data: Client[] }>('/client');
  return data.data;
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const data = await request<{ data: AuditLog[] }>('/audit-logs');
  return data.data;
}
