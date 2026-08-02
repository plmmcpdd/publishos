import { BACKEND_STORAGE_KEY, backendHostname, resolveApiBase } from './api-base';
export { bindingConnectionChanged } from './tiktok-binding';

// ---- Server URL management ----
const BUILD_URL = import.meta.env.VITE_API_URL || '';
const DEV_DEFAULT = 'http://localhost:3000/v1';
export const APP_ENV = import.meta.env.VITE_APP_ENV || 'development';

// Run before React initializes its session state so a legacy token is never
// attached to even the first request sent to the current Staging Backend.
resolveApiBase(localStorage, BUILD_URL, DEV_DEFAULT);

function getApiBase(): string {
  return resolveApiBase(localStorage, BUILD_URL, DEV_DEFAULT).base;
}

export const api = {
  get base() { return getApiBase(); },
  get hostname() { return backendHostname(getApiBase()); },
  setBase(url: string) {
    localStorage.setItem(BACKEND_STORAGE_KEY, url);
    return getApiBase();
  },
  resetBase() { localStorage.removeItem(BACKEND_STORAGE_KEY); },
};

// ---- Delivery state types ----

export type DeliveryState =
  | 'ready_to_review'
  | 'ready_to_send'
  | 'send_requested'
  | 'tiktok_initializing'
  | 'uploading_video'
  | 'tiktok_processing'
  | 'sent_to_tiktok'
  | 'waiting_for_final_tiktok_publish'
  | 'published'
  | 'failed'
  | 'cancelled';

export interface AiDisclosure {
  required: boolean;
  internalReviewConfirmed: boolean;
  method: string;
  apiAutomaticallyApplied: boolean;
  instruction: string;
}

export interface ContentItem {
  id: string;
  title: string;
  description?: string;
  caption?: string;
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
  // Phase 1D delivery fields
  finalCaption?: string;
  hashtags?: string[];
  aiDisclosure?: AiDisclosure;
  deliveryState?: DeliveryState;
  deliveryMessage?: string;
  canRetry?: boolean;
  latestPublishJob?: PublishJobSummary | null;
  targetAccountBinding?: TikTokBinding | null;
}

export interface PublishJobSummary {
  id: string;
  status: string;
  deliveryStage?: string;
  publishId?: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  retryCount?: number;
  inboxDeliveredAt?: string;
  lastPlatformStatus?: string;
  lastStatusCheckedAt?: string;
}

export interface ClientSession {
  token: string;
  client: {
    id: string;
    name: string;
    industry?: string;
  };
}

export interface SendToTikTokResult {
  content: ContentItem;
  publishing: boolean;
  publishJobId?: string | null;
  idempotent?: boolean;
  message?: string;
}

interface ApiContent {
  id: string;
  title: string;
  description?: string;
  caption?: string;
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
  // Phase 1D fields
  finalCaption?: string;
  hashtags?: string[];
  aiDisclosure?: AiDisclosure;
  deliveryState?: DeliveryState;
  deliveryMessage?: string;
  canRetry?: boolean;
  latestPublishJob?: PublishJobSummary | null;
  targetAccountBinding?: TikTokBinding | null;
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
    caption: item.caption,
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
    finalCaption: item.finalCaption,
    hashtags: item.hashtags,
    aiDisclosure: item.aiDisclosure,
    deliveryState: item.deliveryState,
    deliveryMessage: item.deliveryMessage,
    canRetry: item.canRetry,
    latestPublishJob: item.latestPublishJob,
    targetAccountBinding: item.targetAccountBinding || null,
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

export async function fetchContentDetail(id: string): Promise<ContentItem> {
  const clientId = requireClientId();
  const data = await request<{ success: boolean; data: ApiContent }>(
    `/content/${id}?clientId=${encodeURIComponent(clientId)}`,
  );
  return mapContent(data.data);
}

export async function sendToTikTok(
  id: string,
  opts: { contentConfirmed: boolean; aiDisclosureAcknowledged?: boolean; accountBindingId?: string },
): Promise<SendToTikTokResult> {
  const data = await request<{
    success: boolean;
    data: ApiContent & { publishing?: boolean; publishJobId?: string | null; idempotent?: boolean; message?: string };
  }>(`/content/${id}/send-to-tiktok`, {
    method: 'POST',
    body: JSON.stringify({
      clientId: requireClientId(),
      deviceId: requireDeviceId(),
      contentConfirmed: opts.contentConfirmed,
      aiDisclosureAcknowledged: opts.aiDisclosureAcknowledged,
      accountBindingId: opts.accountBindingId,
    }),
  });
  return {
    content: mapContent(data.data),
    publishing: Boolean(data.data.publishing),
    publishJobId: data.data.publishJobId,
    idempotent: data.data.idempotent,
    message: data.data.message,
  };
}

export async function refreshPublishStatus(id: string): Promise<void> {
  await request(`/content/${id}/publish-status/refresh`, { method: 'POST' });
}

export async function retryTikTok(id: string): Promise<SendToTikTokResult> {
  const data = await request<{
    success: boolean;
    data: ApiContent & { publishing?: boolean; publishJobId?: string | null; idempotent?: boolean; message?: string };
  }>(`/content/${id}/retry-tiktok`, {
    method: 'POST',
    body: JSON.stringify({
      clientId: requireClientId(),
      contentConfirmed: true,
    }),
  });
  return {
    content: mapContent(data.data),
    publishing: Boolean(data.data.publishing),
    publishJobId: data.data.publishJobId,
    idempotent: data.data.idempotent,
    message: data.data.message,
  };
}

export async function fetchClientHistory(): Promise<ContentItem[]> {
  const clientId = requireClientId();
  const data = await request<{ success: boolean; data: ApiContent[] }>(
    `/content?clientId=${encodeURIComponent(clientId)}`,
  );
  return data.data.map(mapContent);
}

// ---- TikTok binding ----

export interface TikTokBinding {
  id: string;
  platform: string;
  accountUsername: string;
  username: string;
  displayName?: string;
  status: string;
  active: boolean;
  grantedScopes?: string[];
  reauthorizationRequired: boolean;
  reauthorizationReason?: string | null;
  updatedAt: string;
}

export async function fetchTikTokBindings(): Promise<TikTokBinding[]> {
  const data = await request<{ success: boolean; data: TikTokBinding[] }>(
    '/tiktok/bindings',
  );
  return data.data.filter((binding) => binding.active);
}

export async function getTikTokAuthUrl(): Promise<string> {
  const data = await request<{ success: boolean; data: { authUrl: string } }>(
    '/tiktok/auth',
  );
  return data.data.authUrl;
}

export async function exchangeTikTokCode(code: string, state: string): Promise<{ username: string }> {
  const data = await request<{ success: boolean; data: { username: string } }>(
    '/tiktok/exchange',
    {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    },
  );
  return data.data;
}

export async function disconnectTikTokBinding(id: string): Promise<void> {
  await request(`/tiktok/bindings/${id}`, { method: 'DELETE' });
}
