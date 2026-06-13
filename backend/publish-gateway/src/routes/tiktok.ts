import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || 'http://104.238.181.32:3000/v1/tiktok/callback';
// For Electron: custom protocol redirect
const ELECTRON_REDIRECT_URI = 'publishos://tiktok-callback';

function encodeState(clientId: string): string {
  return Buffer.from(JSON.stringify({ clientId, ts: Date.now() })).toString('base64url');
}

function decodeState(state: string): { clientId: string; ts?: number } {
  return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
}

// ---- Electron OAuth endpoints ----

// GET /tiktok/auth-url?clientId=xxx → returns TikTok auth URL for Electron
router.get('/tiktok/auth-url', async (req, res) => {
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

    const scopes = ['user.info.basic', 'video.publish'];
    const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
    authUrl.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes.join(','));
    authUrl.searchParams.set('redirect_uri', ELECTRON_REDIRECT_URI);
    authUrl.searchParams.set('state', encodeState(clientId));

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

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

    // Exchange code for tokens
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: ELECTRON_REDIRECT_URI,
      }),
    });
    const tokenData: any = await tokenRes.json();
    if (!tokenRes.ok || (tokenData.error?.code && tokenData.error.code !== 'ok')) {
      res.status(400).json({ success: false, error: tokenData.error?.message || 'Token exchange failed' });
      return;
    }

    const accessToken = tokenData.data?.access_token;
    const openId = tokenData.data?.open_id;
    const expiresIn = tokenData.data?.expires_in;
    if (!accessToken || !openId || !expiresIn) {
      res.status(400).json({ success: false, error: 'Missing token data' });
      return;
    }

    // Get user info
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData: any = await userRes.json();
    const username = userData.data?.user?.username || userData.data?.user?.display_name || 'unknown';

    // Save binding
    await prisma.accountBinding.upsert({
      where: { clientId_platform_accountUsername: { clientId, platform: 'tiktok', accountUsername: username } },
      update: {
        platformUserId: openId,
        username,
        accessToken,
        refreshToken: tokenData.data.refresh_token || null,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        scope: tokenData.data.scope || null,
        status: 'active',
        active: true,
      },
      create: {
        clientId,
        platform: 'tiktok',
        accountUsername: username,
        platformUserId: openId,
        username,
        accessToken,
        refreshToken: tokenData.data.refresh_token || null,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        scope: tokenData.data.scope || null,
        status: 'active',
        active: true,
      },
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
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TIKTOK_REDIRECT_URI,
      }),
    });
    const tokenData: any = await tokenRes.json();
    if (!tokenRes.ok || (tokenData.error?.code && tokenData.error.code !== 'ok')) {
      res.status(400).send(`Token error: ${tokenData.error?.message || JSON.stringify(tokenData)}`);
      return;
    }

    const accessToken = tokenData.data?.access_token;
    const openId = tokenData.data?.open_id;
    const expiresIn = tokenData.data?.expires_in;
    if (!accessToken || !openId || !expiresIn) {
      res.status(400).send('Token error: missing token data');
      return;
    }

    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData: any = await userRes.json();
    const username = userData.data?.user?.username || userData.data?.user?.display_name || 'unknown';

    await prisma.accountBinding.upsert({
      where: { clientId_platform_accountUsername: { clientId, platform: 'tiktok', accountUsername: username } },
      update: {
        platformUserId: openId, username, accessToken,
        refreshToken: tokenData.data.refresh_token || null,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        scope: tokenData.data.scope || null, status: 'active', active: true,
      },
      create: {
        clientId, platform: 'tiktok', accountUsername: username,
        platformUserId: openId, username, accessToken,
        refreshToken: tokenData.data.refresh_token || null,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        scope: tokenData.data.scope || null, status: 'active', active: true,
      },
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
        username: binding.username || binding.accountUsername,
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
