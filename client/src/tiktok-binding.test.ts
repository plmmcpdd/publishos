import { describe, expect, it } from 'vitest';
import { bindingConnectionChanged, type BindingConnectionState } from './tiktok-binding';

const binding = (overrides: Partial<BindingConnectionState> = {}): BindingConnectionState => ({
  id: 'binding-a', active: true, status: 'active', reauthorizationRequired: false,
  updatedAt: '2026-07-01T00:00:00.000Z', ...overrides,
});

describe('TikTok reauthorization polling', () => {
  it('detects a new active binding', () => {
    expect(bindingConnectionChanged([], [binding()])).toBe(true);
  });

  it('detects an update to the same binding', () => {
    expect(bindingConnectionChanged([binding({ reauthorizationRequired: true })], [binding({ updatedAt: '2026-07-02T00:00:00.000Z' })])).toBe(true);
  });

  it('does not accept revoked or still-incomplete authorization', () => {
    expect(bindingConnectionChanged([], [binding({ active: false, status: 'revoked' })])).toBe(false);
    expect(bindingConnectionChanged([binding({ reauthorizationRequired: true })], [binding({ reauthorizationRequired: true })])).toBe(false);
  });
});
