import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  fetchTikTokBindings: vi.fn(), getTikTokAuthUrl: vi.fn(), disconnectTikTokBinding: vi.fn(), bindingConnectionChanged: vi.fn(),
  fetchDeliveredContents: vi.fn(), fetchContentDetail: vi.fn(), sendToTikTok: vi.fn(), refreshPublishStatus: vi.fn(), retryTikTok: vi.fn(),
  createMobileCaptionHandoff: vi.fn(), revokeMobileCaptionHandoff: vi.fn(),
  api: { base: 'http://test/v1', hostname: 'test', setBase: vi.fn(), resetBase: vi.fn() }, APP_ENV: 'test', checkServerConnection: vi.fn(),
}));
vi.mock('../api', () => api);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }) }));

import SettingsScreen from './SettingsScreen';
import QueueScreen from './QueueScreen';

const binding = (id: string, username: string, overrides: Record<string, unknown> = {}) => ({ id, platform: 'tiktok', accountUsername: username, username, active: true, status: 'active', grantedScopes: ['video.upload', 'video.list'], reauthorizationRequired: false, updatedAt: '2026-01-01', ...overrides });
const item = (id: string, target: ReturnType<typeof binding> | null, overrides: Record<string, unknown> = {}) => ({ id, title: id, platform: 'tiktok', status: 'delivered', deliveryState: 'ready_to_send', targetAccountBinding: target, createdAt: '2026-01-01', ...overrides });

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); localStorage.setItem('clientId', 'client-a'); localStorage.setItem('token', 'test-token');
  api.fetchTikTokBindings.mockResolvedValue([binding('one', 'one'), binding('two', 'two', { reauthorizationRequired: true })]);
  api.getTikTokAuthUrl.mockResolvedValue('https://example.test/oauth'); api.disconnectTikTokBinding.mockResolvedValue(undefined);
  api.fetchDeliveredContents.mockResolvedValue([]); api.fetchContentDetail.mockImplementation(async (id: string) => item(id, binding('one', 'one')));
  api.sendToTikTok.mockResolvedValue({ content: item('one', binding('one', 'one')), publishing: true }); api.refreshPublishStatus.mockResolvedValue(undefined); api.retryTikTok.mockResolvedValue({});
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { openTikTokAuth: vi.fn().mockResolvedValue(undefined) } });
});

describe('Settings multi-account interaction', () => {
  it('renders independent bindings, disconnects only its target, and still adds an account', async () => {
    const user = userEvent.setup(); render(<SettingsScreen />); await screen.findByText('one · Connected');
    expect(screen.getByText('two · Reconnect required')).toBeTruthy();
    expect(screen.getByText(/TikTok uses the account currently signed in to your browser/)).toBeTruthy();
    await user.click(screen.getAllByText('Disconnect')[0]);
    await waitFor(() => expect(api.disconnectTikTokBinding).toHaveBeenCalledWith('one'));
    expect(screen.getByText('two · Reconnect required')).toBeTruthy();
    await user.click(screen.getByText('Add TikTok Account'));
    await waitFor(() => expect(api.getTikTokAuthUrl).toHaveBeenCalledTimes(1));
    expect(window.electronAPI!.openTikTokAuth).toHaveBeenCalledWith('https://example.test/oauth');
  });
});

describe('Queue account-targeted interaction', () => {
  it('shows per-content targets and sends only a valid content target once', async () => {
    const user = userEvent.setup();
    api.fetchDeliveredContents.mockResolvedValue([item('first', binding('one', 'one')), item('second', binding('two', 'two'))]);
    render(<QueueScreen />); await screen.findByText('Target TikTok Account: @one');
    expect(screen.getByText('Target TikTok Account: @two')).toBeTruthy();
    await user.click(screen.getAllByText('Send to TikTok')[0]);
    await waitFor(() => expect(api.sendToTikTok).toHaveBeenCalledWith('first', expect.objectContaining({ accountBindingId: 'one', contentConfirmed: true })));
  });

  it.each([
    ['missing target', null], ['inactive target', binding('inactive', 'inactive', { active: false })], ['revoked target', binding('revoked', 'revoked', { status: 'revoked' })], ['reconnect target', binding('reconnect', 'reconnect', { reauthorizationRequired: true })], ['scope-less target', binding('scope', 'scope', { grantedScopes: [] })],
  ])('blocks sending for %s without an API request', async (_name, target) => {
    api.fetchDeliveredContents.mockResolvedValue([item(`blocked-${_name}`, target)]);
    render(<QueueScreen />); await screen.findByText(_name === 'missing target' ? 'Target account required' : 'Target account reconnect required');
    const button = screen.getByText(_name === 'missing target' ? 'Target account required' : 'Target account reconnect required') as HTMLButtonElement;
    expect(button.disabled).toBe(true); expect(api.sendToTikTok).not.toHaveBeenCalled();
  });

  it('keeps the target after refresh and displays target_account_mismatch from the server', async () => {
    const user = userEvent.setup(); api.fetchDeliveredContents.mockResolvedValue([item('refreshable', binding('one', 'one'), { deliveryState: 'send_requested' }), item('sendable', binding('two', 'two'))]);
    api.sendToTikTok.mockRejectedValueOnce(new Error('target_account_mismatch'));
    render(<QueueScreen />); await screen.findByText('Refresh Status');
    await user.click(screen.getByText('Refresh Status')); await waitFor(() => expect(api.fetchContentDetail).toHaveBeenCalledWith('refreshable'));
    await user.click(screen.getAllByText('Send to TikTok')[1]); await screen.findByText('target_account_mismatch');
  });
});
