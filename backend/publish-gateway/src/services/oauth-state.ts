import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';

export type OAuthFlow = 'browser' | 'electron';
const STATE_TTL_MS = 10 * 60_000;
export function stateHash(state: string): string { return crypto.createHash('sha256').update(state).digest('hex'); }

export async function createOAuthState(input: { clientId: string; flow: OAuthFlow; redirectUri: string; actorId?: string }): Promise<string> {
  const state = crypto.randomBytes(32).toString('base64url'); const now = new Date(); const expiresAt = new Date(now.getTime() + STATE_TTL_MS);
  await prisma.$transaction(async (tx) => {
    await tx.oAuthAuthorizationState.deleteMany({ where: { expiresAt: { lt: now } } });
    await tx.oAuthAuthorizationState.create({ data: { provider: 'tiktok', stateHash: stateHash(state), clientId: input.clientId, flow: input.flow, redirectUri: input.redirectUri, actorId: input.actorId, expiresAt } });
    await tx.auditLog.create({ data: { action: 'oauth_started', actorId: input.actorId, actorType: 'oauth', targetType: 'client', targetId: input.clientId, details: JSON.stringify({ provider: 'tiktok', flow: input.flow }) } });
  });
  return state;
}

export async function consumeOAuthState(input: { state: string; flow: OAuthFlow; redirectUri: string; expectedClientId?: string }): Promise<{ clientId: string }> {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(input.state)) throw new AppError(400, 'oauth_state_invalid', 'OAuth state is invalid');
  const hash = stateHash(input.state); const now = new Date();
  return prisma.$transaction(async (tx) => {
    const consumed = await tx.oAuthAuthorizationState.updateMany({
      where: { stateHash: hash, provider: 'tiktok', flow: input.flow, redirectUri: input.redirectUri, ...(input.expectedClientId ? { clientId: input.expectedClientId } : {}), consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      const existing = await tx.oAuthAuthorizationState.findUnique({ where: { stateHash: hash }, select: { consumedAt: true, expiresAt: true, flow: true } });
      if (existing?.consumedAt) throw new AppError(409, 'oauth_state_replayed', 'OAuth state has already been used');
      if (existing && existing.expiresAt <= now) throw new AppError(410, 'oauth_state_expired', 'OAuth state has expired');
      if (existing && existing.flow !== input.flow) throw new AppError(400, 'oauth_flow_mismatch', 'OAuth state flow is invalid');
      // Do not disclose the state owner. The conditional update above leaves it unconsumed.
      if (existing && input.expectedClientId) throw new AppError(403, 'tenant_mismatch', 'Tenant does not match token');
      throw new AppError(400, 'oauth_state_invalid', 'OAuth state is invalid');
    }
    const record = await tx.oAuthAuthorizationState.findUnique({ where: { stateHash: hash }, select: { clientId: true, flow: true, redirectUri: true, actorId: true, expiresAt: true, consumedAt: true } });
    if (!record?.consumedAt) throw new AppError(500, 'internal_error', 'OAuth state consumption failed');
    await tx.auditLog.create({ data: { action: 'oauth_state_consumed', actorId: record.actorId, actorType: 'oauth', targetType: 'client', targetId: record.clientId, details: JSON.stringify({ provider: 'tiktok', flow: record.flow }) } });
    return { clientId: record.clientId };
  });
}
