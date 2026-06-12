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
  email: string;
  industry?: string | null;
  active: boolean;
}

export interface AdminSession {
  token: string;
  admin: {
    id: string;
    name: string;
    email: string;
  };
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
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = localStorage.getItem('adminToken');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `API ${response.status}`;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      // Keep status message.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export async function adminLogin(email: string, password: string): Promise<AdminSession> {
  const data = await request<{ success: boolean; data: AdminSession; error?: string }>('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!data.success) throw new Error(data.error || 'Login failed');
  return data.data;
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

export async function createClient(input: { name: string; email: string; password: string; industry?: string }): Promise<Client> {
  const data = await request<{ success: boolean; data: Client }>('/client', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.data;
}

export async function updateClient(id: string, input: { name: string; email: string; industry?: string; active?: boolean }): Promise<Client> {
  const data = await request<{ success: boolean; data: Client }>(`/client/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return data.data;
}

export async function resetClientPassword(id: string, password: string): Promise<void> {
  await request(`/client/${id}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
}

export async function deleteClient(id: string): Promise<void> {
  await request(`/client/${id}`, { method: 'DELETE' });
}

export async function uploadVideo(file: File): Promise<{ url: string; filename: string; size: number }> {
  const body = new FormData();
  body.append('video', file);
  const data = await request<{ success: boolean; data: { url: string; filename: string; size: number } }>('/upload/video', {
    method: 'POST',
    body,
  });
  return data.data;
}

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const data = await request<{ data: AuditLog[] }>('/audit-logs');
  return data.data;
}
