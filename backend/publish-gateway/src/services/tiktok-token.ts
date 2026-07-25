import { prisma } from '../lib/prisma';

const TIKTOK_TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';

export type TikTokTokenBinding = {
  id: string;
  clientId: string;
  platform: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  status: string;
  active: boolean;
};

export type TikTokResponse = {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  code?: string;
  message?: string;
};

export class TikTokTokenError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly temporary = false,
  ) {
    super(message);
  }
}

function timeoutSignal(milliseconds = 10_000): AbortSignal {
  return AbortSignal.timeout(milliseconds);
}

function credentials(): { key: string; secret: string } {
  const key = process.env.TIKTOK_CLIENT_KEY || '';
  const secret = process.env.TIKTOK_CLIENT_SECRET || '';
  if (!key || !secret) {
    throw new TikTokTokenError('tiktok_not_configured', 'TikTok credentials are not configured on the server');
  }
  return { key, secret };
}

function safeUpstreamCode(data: TikTokResponse, fallback: string): string {
  const value = data.error?.code || data.code;
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : fallback;
}

async function responseJson(response: Response): Promise<TikTokResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as TikTokResponse : {};
  } catch {
    return {};
  }
}

function tokenFields(data: TikTokResponse): {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
} {
  const nested = data.data && typeof data.data === 'object' ? data.data : {};
  const accessToken = nested.access_token ?? (data as Record<string, unknown>).access_token;
  const refreshToken = nested.refresh_token ?? (data as Record<string, unknown>).refresh_token;
  const expiresInValue = nested.expires_in ?? (data as Record<string, unknown>).expires_in;
  const scope = nested.scope ?? (data as Record<string, unknown>).scope;
  const expiresIn = Number(expiresInValue);
  return {
    accessToken: typeof accessToken === 'string' ? accessToken : undefined,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : undefined,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
    scope: typeof scope === 'string' ? scope : undefined,
  };
}

export async function markBindingExpired(bindingId: string): Promise<void> {
  await prisma.accountBinding.updateMany({
    where: { id: bindingId },
    data: { active: false, status: 'expired' },
  });
}

export async function markBindingReauthorizationRequired(bindingId: string, reason: string): Promise<void> {
  await prisma.accountBinding.update({
    where: { id: bindingId },
    data: {
      reauthorizationRequired: true,
      reauthorizationReason: reason,
    },
  });
}

export async function refreshTikTokToken(binding: TikTokTokenBinding): Promise<string> {
  if (!binding.refreshToken) {
    await markBindingExpired(binding.id);
    throw new TikTokTokenError(
      'tiktok_connection_expired',
      'TikTok connection expired. Reconnect TikTok and retry.',
      true,
    );
  }

  const creds = credentials();
  let response: Response;
  try {
    response = await fetch(TIKTOK_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: creds.key,
        client_secret: creds.secret,
        grant_type: 'refresh_token',
        refresh_token: binding.refreshToken,
      }),
      signal: timeoutSignal(),
    });
  } catch {
    throw new TikTokTokenError('tiktok_refresh_unavailable', 'TikTok token refresh failed.', true, true);
  }

  const data = await responseJson(response);
  const upstreamCode = safeUpstreamCode(data, response.ok ? 'invalid_response' : `http_${response.status}`);
  if (!response.ok || (data.error?.code && data.error.code !== 'ok')) {
    if (['access_token_invalid', 'invalid_grant', 'scope_not_authorized'].includes(upstreamCode)) {
      await markBindingExpired(binding.id);
      throw new TikTokTokenError(
        'tiktok_connection_expired',
        'TikTok connection expired. Reconnect TikTok and retry.',
        true,
      );
    }
    throw new TikTokTokenError(
      upstreamCode === 'rate_limit_exceeded' ? 'tiktok_rate_limited' : 'tiktok_refresh_failed',
      'TikTok token refresh failed.',
      true,
      response.status === 429 || response.status >= 500,
    );
  }

  const tokens = tokenFields(data);
  if (!tokens.accessToken) {
    throw new TikTokTokenError('tiktok_refresh_failed', 'TikTok token refresh returned an invalid response.', true);
  }

  await prisma.accountBinding.update({
    where: { id: binding.id },
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || binding.refreshToken,
      expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : binding.expiresAt,
      scope: tokens.scope || binding.scope,
      status: 'active',
      active: true,
    },
  });
  return tokens.accessToken;
}

export async function getValidAccessToken(binding: TikTokTokenBinding): Promise<string> {
  if (!binding.active || binding.status !== 'active') {
    throw new TikTokTokenError(
      'tiktok_connection_expired',
      'TikTok connection is inactive. Reconnect TikTok and retry.',
      true,
    );
  }
  if (binding.platform !== 'tiktok') {
    throw new TikTokTokenError('tiktok_binding_invalid', 'The selected account is not a TikTok binding.');
  }
  if (!binding.accessToken) {
    throw new TikTokTokenError(
      'tiktok_connection_expired',
      'TikTok connection is missing an access token. Reconnect TikTok and retry.',
      true,
    );
  }
  if (!binding.expiresAt || binding.expiresAt > new Date(Date.now() + 60_000)) return binding.accessToken;
  return refreshTikTokToken(binding);
}

export function hasScope(binding: TikTokTokenBinding, requiredScope: string): boolean {
  // If scope is not set, assume all scopes are granted (backward compatibility)
  if (!binding.scope) return true;
  const scopes = binding.scope.split(/[,\s]+/u);
  return scopes.includes(requiredScope);
}
