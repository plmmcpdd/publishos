import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, clientIdFromAuth } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { consumeOAuthState, createOAuthState, type OAuthFlow } from '../services/oauth-state';
import { rateLimit } from '../middleware/http-security';

const router = Router();
const TIKTOK_TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
const ELECTRON_REDIRECT_URI = 'publishos://tiktok-callback';
function browserRedirectUri(): string { return process.env.TIKTOK_REDIRECT_URI || (process.env.NODE_ENV === 'test' ? 'http://localhost:3000/v1/tiktok/callback' : ''); }
function credentials(): { key: string; secret: string } { const key = process.env.TIKTOK_CLIENT_KEY || ''; const secret = process.env.TIKTOK_CLIENT_SECRET || ''; if (!key || !secret) throw new AppError(500, 'oauth_not_configured', 'TikTok OAuth is not configured'); return { key, secret }; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!)); }
function callbackSecurityHeaders(res: Response): string {
  const nonce = crypto.randomBytes(18).toString('base64url');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  return nonce;
}
function timeoutSignal(ms = 10_000): AbortSignal { return AbortSignal.timeout(ms); }

function authUrl(state: string, redirectUri: string): string {
  const { key } = credentials(); const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', key); url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', 'user.info.basic,video.upload'); url.searchParams.set('redirect_uri', redirectUri); url.searchParams.set('state', state); return url.toString();
}
async function exchange(code: string, redirectUri: string) {
  const { key, secret } = credentials();
  let response: globalThis.Response;
  try { response = await fetch(TIKTOK_TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: key, client_secret: secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }), signal: timeoutSignal() }); }
  catch { throw new AppError(502, 'oauth_exchange_failed', 'TikTok token exchange failed'); }
  const text = await response.text(); let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new AppError(502, 'oauth_exchange_failed', 'TikTok token exchange failed'); }
  if (!response.ok || (data.error?.code && data.error.code !== 'ok')) throw new AppError(502, 'oauth_exchange_failed', 'TikTok token exchange failed');
  const token = data.data?.access_token ?? data.access_token; const openId = data.data?.open_id ?? data.open_id; const expiresIn = Number(data.data?.expires_in ?? data.expires_in); const refreshToken = data.data?.refresh_token ?? data.refresh_token; const scope = data.data?.scope ?? data.scope;
  if (!token || !openId || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new AppError(502, 'oauth_exchange_failed', 'TikTok token exchange failed');
  return { token, openId, expiresIn, refreshToken, scope };
}
async function profile(accessToken: string, openId: string): Promise<string> {
  try { const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', { headers: { Authorization: `Bearer ${accessToken}` }, signal: timeoutSignal() }); const data: any = await response.json(); const name = data?.data?.user?.display_name || data?.user?.display_name; return typeof name === 'string' && name.trim() ? name.trim() : `TikTok User ${openId.slice(-8)}`; }
  catch { return `TikTok User ${openId.slice(-8)}`; }
}
async function saveBinding(input: { clientId: string; username: string; openId: string; token: string; refreshToken?: string; expiresIn: number; scope?: string }) {
  if (input.scope && !input.scope.split(/[,\s]+/u).includes('video.upload')) {
    throw new AppError(409, 'oauth_scope_missing', 'TikTok authorization did not grant video.upload');
  }
  await prisma.$transaction(async (tx) => {
    const data = { accountUsername: input.username, username: input.username, platformUserId: input.openId, accessToken: input.token, refreshToken: input.refreshToken || null, expiresAt: new Date(Date.now() + input.expiresIn * 1000), scope: input.scope || null, status: 'active', active: true };
    await tx.accountBinding.upsert({ where: { clientId_platform_accountUsername: { clientId: input.clientId, platform: 'tiktok', accountUsername: input.username } }, update: data, create: { clientId: input.clientId, platform: 'tiktok', ...data } });
    await tx.auditLog.create({ data: { action: 'oauth_binding_created', actorType: 'oauth', targetType: 'client', targetId: input.clientId, details: JSON.stringify({ provider: 'tiktok' }) } });
  });
}
async function start(req: Request, res: Response, flow: OAuthFlow) {
  const supplied = typeof req.query.clientId === 'string' ? req.query.clientId : undefined; const clientId = clientIdFromAuth(req, supplied);
  if (!clientId) throw new AppError(400, 'validation_error', 'clientId is required');
  const redirectUri = flow === 'electron' ? ELECTRON_REDIRECT_URI : browserRedirectUri(); if (!redirectUri) throw new AppError(503, 'oauth_not_configured', 'TikTok OAuth is not configured');
  const state = await createOAuthState({ clientId, flow, redirectUri, actorId: req.auth?.sub });
  res.json({ success: true, data: { authUrl: authUrl(state, redirectUri), expires_at: new Date(Date.now() + 600_000).toISOString() } });
}
router.get('/tiktok/auth', authenticateToken, rateLimit('oauth_browser_start', 30, 10 * 60_000), (req, res, next) => { void start(req, res, 'browser').catch(next); });
router.get('/tiktok/auth-url', authenticateToken, rateLimit('oauth_electron_start', 30, 10 * 60_000), (req, res, next) => { void start(req, res, 'electron').catch(next); });

router.post('/tiktok/exchange', authenticateToken, rateLimit('oauth_electron_exchange', 30, 10 * 60_000), async (req, res, next) => {
  try { const scoped = clientIdFromAuth(req, req.body?.clientId); credentials(); const code = typeof req.body?.code === 'string' ? req.body.code : ''; const state = typeof req.body?.state === 'string' ? req.body.state : ''; if (!code || !state) throw new AppError(400, 'validation_error', 'code and state are required');
    if (!scoped) throw new AppError(403, 'tenant_mismatch', 'Tenant does not match token');
    const consumed = await consumeOAuthState({ state, flow: 'electron', redirectUri: ELECTRON_REDIRECT_URI, expectedClientId: scoped });
    const tokens = await exchange(code, ELECTRON_REDIRECT_URI); const username = await profile(tokens.token, tokens.openId); await saveBinding({ clientId: consumed.clientId, username, openId: tokens.openId, token: tokens.token, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn, scope: tokens.scope }); res.json({ success: true, data: { username, platform: 'tiktok', message: 'TikTok account connected' } });
  } catch (error) { next(error); }
});
router.get('/tiktok/callback', rateLimit('oauth_browser_callback', 30, 10 * 60_000), async (req, res, next) => {
  try { const error = typeof req.query.error === 'string' ? req.query.error : ''; const code = typeof req.query.code === 'string' ? req.query.code : ''; const state = typeof req.query.state === 'string' ? req.query.state : ''; if (error) { const nonce = callbackSecurityHeaders(res); res.status(400).type('html').send(`<html><body><h1>TikTok connection was not completed</h1><p>${escapeHtml(typeof req.query.error_description === 'string' ? req.query.error_description : 'Please return to PublishOS and try again.')}</p><script nonce="${escapeHtml(nonce)}">setTimeout(function(){window.close()},3000)</script></body></html>`); return; } if (!code || !state) throw new AppError(400, 'oauth_state_invalid', 'OAuth callback is invalid');
    const redirectUri = browserRedirectUri(); if (!redirectUri) throw new AppError(503, 'oauth_not_configured', 'TikTok OAuth is not configured'); const consumed = await consumeOAuthState({ state, flow: 'browser', redirectUri }); const tokens = await exchange(code, redirectUri); const username = await profile(tokens.token, tokens.openId); await saveBinding({ clientId: consumed.clientId, username, openId: tokens.openId, token: tokens.token, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn, scope: tokens.scope });
    const nonce = callbackSecurityHeaders(res); res.type('html').send(`<html><body style="font-family:sans-serif;text-align:center;padding:50px"><h1>TikTok Connected!</h1><p>Account: @${escapeHtml(username)}</p><p>You can close this window and return to PublishOS.</p><script nonce="${escapeHtml(nonce)}">setTimeout(function(){window.close()},3000)</script></body></html>`);
  } catch (error) { next(error); }
});
router.get('/tiktok/bindings/:clientId', authenticateToken, async (req, res, next) => { try { const clientId = clientIdFromAuth(req, req.params.clientId); const data = await prisma.accountBinding.findMany({ where: { clientId: clientId!, platform: 'tiktok' }, select: { id: true, platform: true, accountUsername: true, username: true, platformUserId: true, status: true, active: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }); res.json({ success: true, data }); } catch (error) { next(error); } });
router.delete('/tiktok/bindings/:id', authenticateToken, async (req, res, next) => { try { if (req.auth?.tokenType !== 'admin' && req.auth?.tokenType !== 'client') throw new AppError(403, 'forbidden', 'Insufficient permissions'); const binding = await prisma.accountBinding.findFirst({ where: { id: String(req.params.id), ...(req.auth.tokenType === 'client' ? { clientId: req.auth.clientId } : {}) } }); if (!binding) throw new AppError(404, 'not_found', 'Binding not found'); await prisma.accountBinding.update({ where: { id: binding.id }, data: { active: false, status: 'revoked' } }); res.json({ success: true }); } catch (error) { next(error); } });
export default router;
