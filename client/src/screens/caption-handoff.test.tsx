import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  fetchDeliveredContents: vi.fn(), fetchContentDetail: vi.fn(), sendToTikTok: vi.fn(), refreshPublishStatus: vi.fn(), retryTikTok: vi.fn(),
  createMobileCaptionHandoff: vi.fn(), revokeMobileCaptionHandoff: vi.fn(),
  api: { base: 'http://test/v1' },
}));
vi.mock('../api', () => api);
import QueueScreen from './QueueScreen';

const target = { id: 'target-a', accountUsername: 'target-a', username: 'target-a', active: true, status: 'active', reauthorizationRequired: false, grantedScopes: ['video.upload'] };
const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, title: `Internal ${id}`, description: 'Operator description', caption: 'Caption body', hashtags: ['#tag1', '#中文'],
  tiktokCaptionText: 'Caption body\n\n#tag1 #中文', tiktokCaptionHasContent: true,
  platform: 'tiktok', status: 'delivered', deliveryState: 'ready_to_send', targetAccountBinding: target, createdAt: '2026-01-01', ...overrides,
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.setItem('clientId', 'client-a'); localStorage.setItem('token', 'test');
  api.fetchDeliveredContents.mockResolvedValue([item('one')]); api.fetchContentDetail.mockResolvedValue(item('one')); api.sendToTikTok.mockResolvedValue({});
  api.refreshPublishStatus.mockResolvedValue(undefined); api.retryTikTok.mockResolvedValue(undefined);
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { copyText: vi.fn().mockResolvedValue(undefined) } });
});

describe('TikTok caption handoff', () => {
  it('shows an isolated card caption and copies the exact backend handoff text without sending', async () => {
    const user = userEvent.setup(); api.fetchDeliveredContents.mockResolvedValue([item('one'), item('two', { caption: 'Second', tiktokCaptionText: 'Second\n\n#two', hashtags: ['#two'] })]);
    render(<QueueScreen />);
    await screen.findAllByText('Content Title');
    expect(screen.getAllByText('Target TikTok Account: @target-a')).toHaveLength(2);
    expect(screen.getByText('Caption body')).toBeTruthy(); expect(screen.getByText('#tag1 #中文')).toBeTruthy();
    await user.click(screen.getAllByText('Copy Caption')[1]);
    await waitFor(() => expect(window.electronAPI!.copyText).toHaveBeenCalledWith('Second\n\n#two'));
    expect(api.sendToTikTok).not.toHaveBeenCalled(); expect(await screen.findByText('Caption copied')).toBeTruthy();
  });

  it('disables old empty captions, surfaces copy errors, and permits copy while the target is invalid', async () => {
    const user = userEvent.setup();
    api.fetchDeliveredContents.mockResolvedValue([item('legacy', { caption: null, hashtags: [], tiktokCaptionText: '', tiktokCaptionHasContent: false }), item('invalid-target', { targetAccountBinding: null })]);
    render(<QueueScreen />); await screen.findByText('No caption provided');
    expect((screen.getAllByText('Copy Caption')[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Target account required') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getAllByText('Copy Caption')[1]);
    await waitFor(() => expect(window.electronAPI!.copyText).toHaveBeenCalledWith('Caption body\n\n#tag1 #中文'));
    (window.electronAPI!.copyText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Denied'));
    await user.click(screen.getAllByText('Copy Caption')[1]);
    expect(await screen.findByText('Could not copy caption: Denied')).toBeTruthy();
  });

  it('keeps send independent, and gives the manual Inbox completion instructions after delivery', async () => {
    const user = userEvent.setup(); api.fetchDeliveredContents.mockResolvedValue([item('sent', { deliveryState: 'waiting_for_final_tiktok_publish' })]);
    render(<QueueScreen />); await screen.findByText('Video sent to TikTok Inbox.');
    expect(screen.getByText(/Paste the copied caption/)).toBeTruthy();
    await user.click(screen.getByText('Refresh Status'));
    expect(api.fetchContentDetail).toHaveBeenCalledWith('sent'); expect(window.electronAPI!.copyText).not.toHaveBeenCalled();
  });
});
