import { Request, Response, Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || 'https://reaching-combines-bass-propose.trycloudflare.com/v1/tiktok/callback';
// For Electron: custom protocol redirect
const ELECTRON_REDIRECT_URI = 'publishos://tiktok-callback';
const TIKTOK_TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';

type TikTokTokenPayload = Record<string, any>;

function encodeState(clientId: string): string {
  return Buffer.from(JSON.stringify({ clientId, ts: Date.now() })).toString('base64url');
}

function decodeState(state: string): { clientId: string; ts?: number } {
  return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
}

function redactTikTokTokenBody(value: any): any {
  if (Array.isArray(value)) return value.map(redactTikTokTokenBody);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (/token|secret/i.test(key)) return [key, entry ? '[redacted]' : entry];
    return [key, redactTikTokTokenBody(entry)];
  }));
}

function getTikTokTokenValue(tokenData: TikTokTokenPayload, field: string) {
  return tokenData?.data?.[field] ?? tokenData?.[field];
}

function describeTikTokTokenError(tokenData: TikTokTokenPayload, fallback = 'Token exchange failed') {
  const error = tokenData?.error;
  const parts = [
    typeof error === 'string' ? error : undefined,
    error?.code,
    error?.message,
    tokenData?.error_description,
    tokenData?.message,
    tokenData?.log_id ? `log_id=${tokenData.log_id}` : undefined,
    error?.log_id ? `log_id=${error.log_id}` : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(' | ') : fallback;
}

async function exchangeTikTokToken(code: string, redirectUri: string) {
  const tokenRes = await fetch(TIKTOK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  const rawBody = await tokenRes.text();
  let tokenData: TikTokTokenPayload;
  try {
    tokenData = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    tokenData = { message: rawBody || 'Non-JSON response from TikTok token endpoint' };
  }

  console.log('TikTok token exchange response', {
    status: tokenRes.status,
    ok: tokenRes.ok,
    redirectUri,
    body: redactTikTokTokenBody(tokenData),
  });

  return { tokenRes, tokenData };
}

function readTikTokTokenFields(tokenData: TikTokTokenPayload) {
  const accessToken = getTikTokTokenValue(tokenData, 'access_token');
  const refreshToken = getTikTokTokenValue(tokenData, 'refresh_token');
  const openId = getTikTokTokenValue(tokenData, 'open_id');
  const expiresIn = getTikTokTokenValue(tokenData, 'expires_in');
  const scope = getTikTokTokenValue(tokenData, 'scope');

  return { accessToken, refreshToken, openId, expiresIn, scope };
}

function missingTikTokTokenFields(fields: ReturnType<typeof readTikTokTokenFields>) {
  return [
    ['access_token', fields.accessToken],
    ['open_id', fields.openId],
    ['expires_in', fields.expiresIn],
  ].filter(([, value]) => !value).map(([field]) => field);
}

function shortOpenId(openId?: string | null) {
  return openId ? openId.slice(-8) : '';
}

function fallbackTikTokName(openId?: string | null) {
  const suffix = shortOpenId(openId);
  return suffix ? `TikTok User ${suffix}` : 'TikTok Account';
}

function normalizeTikTokName(value?: string | null) {
  if (!value || value.trim().toLowerCase() === 'unknown') return null;
  return value.trim();
}

function getTikTokDisplayName(userData: any, openId?: string | null) {
  const user = userData?.data?.user || userData?.user || {};
  return normalizeTikTokName(user.display_name)
    || normalizeTikTokName(user.username)
    || normalizeTikTokName(user.open_id)
    || fallbackTikTokName(openId);
}

function presentTikTokBindingName(binding: {
  username?: string | null;
  accountUsername?: string | null;
  platformUserId?: string | null;
}) {
  return normalizeTikTokName(binding.username)
    || normalizeTikTokName(binding.accountUsername)
    || fallbackTikTokName(binding.platformUserId);
}

async function saveTikTokBinding(input: {
  clientId: string;
  username: string;
  openId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresIn: number;
  scope?: string | null;
}) {
  const existingBinding = await prisma.accountBinding.findFirst({
    where: {
      clientId: input.clientId,
      platform: 'tiktok',
      platformUserId: input.openId,
    },
  });

  const data = {
    accountUsername: input.username,
    platformUserId: input.openId,
    username: input.username,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken || null,
    expiresAt: new Date(Date.now() + input.expiresIn * 1000),
    scope: input.scope || null,
    status: 'active',
    active: true,
  };

  if (existingBinding) {
    await prisma.accountBinding.update({
      where: { id: existingBinding.id },
      data,
    });
    return;
  }

  await prisma.accountBinding.upsert({
    where: {
      clientId_platform_accountUsername: {
        clientId: input.clientId,
        platform: 'tiktok',
        accountUsername: input.username,
      },
    },
    update: data,
    create: {
      clientId: input.clientId,
      platform: 'tiktok',
      ...data,
    },
  });
}

// ---- Electron OAuth endpoints ----

// GET /tiktok/auth-url?clientId=xxx → returns TikTok auth URL for Electron
function buildTikTokAuthUrl(clientId: string, redirectUri: string) {
  const scopes = ['user.info.basic', 'video.upload'];
  const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
  authUrl.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes.join(','));
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', encodeState(clientId));
  return authUrl.toString();
}

async function handleTikTokAuthUrl(req: Request, res: Response, redirectUri: string) {
  try {
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : '';
    if (!clientId) {
      res.status(400).json({ success: false, error: 'clientId required' });
      return;
    }
    if (!TIKTOK_CLIENT_KEY) {
      res.status(500).json({ success: false, error: 'TIKTOK_CLIENT_KEY is not configured' });
      return;
    }

    res.json({ success: true, data: { authUrl: buildTikTokAuthUrl(clientId, redirectUri) } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
}

router.get('/tiktok/auth', (req, res) => void handleTikTokAuthUrl(req, res, TIKTOK_REDIRECT_URI));
router.get('/tiktok/auth-url', (req, res) => void handleTikTokAuthUrl(req, res, ELECTRON_REDIRECT_URI));

// POST /tiktok/exchange { code, clientId } → exchanges code for tokens, saves binding
router.post('/tiktok/exchange', async (req, res) => {
  try {
    const { code, clientId } = req.body;
    if (!code || !clientId) {
      res.status(400).json({ success: false, error: 'code and clientId required' });
      return;
    }
    if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
      res.status(500).json({ success: false, error: 'TikTok credentials not configured' });
      return;
    }

    const { tokenRes, tokenData } = await exchangeTikTokToken(code, ELECTRON_REDIRECT_URI);
    if (!tokenRes.ok || (tokenData.error?.code && tokenData.error.code !== 'ok')) {
      res.status(400).json({ success: false, error: describeTikTokTokenError(tokenData) });
      return;
    }

    const tokenFields = readTikTokTokenFields(tokenData);
    const missingFields = missingTikTokTokenFields(tokenFields);
    if (missingFields.length) {
      res.status(400).json({ success: false, error: `Missing token fields: ${missingFields.join(', ')}` });
      return;
    }
    const { accessToken, refreshToken, openId, expiresIn, scope } = tokenFields;

    // Get user info
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData: any = await userRes.json();
    const username = getTikTokDisplayName(userData, openId);

    await saveTikTokBinding({
        clientId,
        username,
        openId,
        accessToken,
        refreshToken,
        expiresIn,
        scope,
    });

    res.json({
      success: true,
      data: { username, platform: 'tiktok', message: 'TikTok account connected' },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Browser callback route (TikTok redirects here after auth)
router.get('/tiktok/callback', async (req, res) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }
    if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
      res.status(500).send('TikTok credentials are not configured');
      return;
    }

    const { clientId } = decodeState(state);
    const { tokenRes, tokenData } = await exchangeTikTokToken(code, TIKTOK_REDIRECT_URI);
    if (!tokenRes.ok || (tokenData.error?.code && tokenData.error.code !== 'ok')) {
      res.status(400).send(`Token error: ${describeTikTokTokenError(tokenData)}`);
      return;
    }

    const tokenFields = readTikTokTokenFields(tokenData);
    const missingFields = missingTikTokTokenFields(tokenFields);
    if (missingFields.length) {
      const message = `Missing token fields: ${missingFields.join(', ')}`;
      console.error('TikTok token exchange missing fields', {
        missingFields,
        status: tokenRes.status,
        body: redactTikTokTokenBody(tokenData),
      });
      res.status(400).send(`Token error: ${message}`);
      return;
    }
    const { accessToken, refreshToken, openId, expiresIn, scope } = tokenFields;

    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData: any = await userRes.json();
    const username = getTikTokDisplayName(userData, openId);

    await saveTikTokBinding({
      clientId,
      username,
      openId,
      accessToken,
      refreshToken,
      expiresIn,
      scope,
    });

    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h1>TikTok Connected!</h1>
        <p>Account: @${username}</p>
        <p>You can close this window and return to PublishOS.</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      </body></html>
    `);
  } catch (error) {
    res.status(500).send(`Error: ${String(error)}`);
  }
});

router.get('/tiktok/bindings/:clientId', async (req, res) => {
  try {
    const bindings = await prisma.accountBinding.findMany({
      where: { clientId: req.params.clientId, platform: 'tiktok' },
      select: {
        id: true,
        platform: true,
        accountUsername: true,
        platformUserId: true,
        username: true,
        status: true,
        active: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      success: true,
      data: bindings.map((binding) => ({
        ...binding,
        username: presentTikTokBindingName(binding),
        displayName: presentTikTokBindingName(binding),
        openId: binding.platformUserId,
        status: binding.active ? binding.status : 'revoked',
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

router.delete('/tiktok/bindings/:id', async (req, res) => {
  try {
    await prisma.accountBinding.update({
      where: { id: req.params.id },
      data: { active: false, status: 'revoked' },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
