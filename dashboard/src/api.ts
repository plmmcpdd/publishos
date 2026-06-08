export const API_BASE = 'http://localhost:3000/api/v1';

export interface Stats {
  todayPublished: number;
  pending: number;
  totalCustomers: number;
  failed: number;
}

export interface ContentItem {
  id: string;
  title: string;
  platform?: string;
  platforms?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  thumbnail_url?: string;
  thumbnailUrl?: string;
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

export async function fetchContents(status: string): Promise<ContentItem[]> {
  const data = await request<{ data: ContentItem[] }>(`/contents?status=${encodeURIComponent(status)}`);
  return data.data;
}

export async function approveContent(id: string): Promise<void> {
  await request(`/contents/${id}/approve`, { method: 'POST' });
}

export async function rejectContent(id: string): Promise<void> {
  await request(`/contents/${id}/reject`, { method: 'POST' });
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const data = await request<{ data: AuditLog[] }>('/audit-logs');
  return data.data;
}
