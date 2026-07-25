import { describe, expect, it } from 'vitest';
import { hasScope, type TikTokTokenBinding } from '../src/services/tiktok-token';

function makeBinding(scope: string | null): TikTokTokenBinding {
  return {
    id: 'test-binding-id',
    clientId: 'test-client-id',
    platform: 'tiktok',
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    expiresAt: new Date(Date.now() + 3600_000),
    scope,
    status: 'active',
    active: true,
  };
}

describe('Phase 2A: hasScope', () => {
  it('returns true when scope contains the required scope', () => {
    const binding = makeBinding('user.info.basic,video.upload,video.list');
    expect(hasScope(binding, 'video.list')).toBe(true);
  });

  it('returns false when scope does not contain the required scope', () => {
    const binding = makeBinding('user.info.basic,video.upload');
    expect(hasScope(binding, 'video.list')).toBe(false);
  });

  it('returns true when scope is null (backward compatibility)', () => {
    const binding = makeBinding(null);
    expect(hasScope(binding, 'video.list')).toBe(true);
  });

  it('handles space-separated scopes', () => {
    const binding = makeBinding('user.info.basic video.upload video.list');
    expect(hasScope(binding, 'video.list')).toBe(true);
  });

  it('handles comma-separated scopes with spaces', () => {
    const binding = makeBinding('user.info.basic, video.upload, video.list');
    expect(hasScope(binding, 'video.list')).toBe(true);
  });

  it('does not match partial scope names', () => {
    const binding = makeBinding('video.upload');
    expect(hasScope(binding, 'video')).toBe(false);
  });

  it('checks for video.upload', () => {
    const binding = makeBinding('user.info.basic,video.upload');
    expect(hasScope(binding, 'video.upload')).toBe(true);
  });

  it('checks for user.info.basic', () => {
    const binding = makeBinding('user.info.basic,video.upload');
    expect(hasScope(binding, 'user.info.basic')).toBe(true);
  });
});
