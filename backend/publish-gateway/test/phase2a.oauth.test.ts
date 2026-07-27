import { describe, expect, it } from 'vitest';
import { REQUIRED_TIKTOK_SCOPES as REQUIRED_SCOPES } from '../src/services/tiktok-scopes';

describe('Phase 2A: OAuth scope', () => {
  it('REQUIRED_SCOPES includes video.list', () => {
    expect(REQUIRED_SCOPES).toContain('video.list');
  });

  it('REQUIRED_SCOPES includes video.upload', () => {
    expect(REQUIRED_SCOPES).toContain('video.upload');
  });

  it('REQUIRED_SCOPES includes user.info.basic', () => {
    expect(REQUIRED_SCOPES).toContain('user.info.basic');
  });

  it('REQUIRED_SCOPES has exactly 3 scopes', () => {
    expect(REQUIRED_SCOPES).toHaveLength(3);
  });

  it('REQUIRED_SCOPES are in the expected order', () => {
    expect(REQUIRED_SCOPES).toEqual(['user.info.basic', 'video.upload', 'video.list']);
  });
});
