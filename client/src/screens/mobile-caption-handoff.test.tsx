import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  fetchDeliveredContents: vi.fn(), fetchContentDetail: vi.fn(), sendToTikTok: vi.fn(), refreshPublishStatus: vi.fn(), retryTikTok: vi.fn(),
  createMobileCaptionHandoff: vi.fn(), revokeMobileCaptionHandoff: vi.fn(),
  api: { base: 'https://api.example.test/v1' },
}));
const qr = vi.hoisted(() => ({ toDataURL: vi.fn() }));
vi.mock('../api', () => api);
vi.mock('qrcode', () => ({ default: qr }));
import QueueScreen from './QueueScreen';

const target = { id: 'binding-a', accountUsername: 'safe-account', username: 'safe-account', active: true, status: 'active', reauthorizationRequired: false, grantedScopes: ['video.upload'] };
const item = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, title: `Title ${id}`, description: 'Description', caption: 'Caption body', hashtags: ['#one'],
  tiktokCaptionText: 'Caption body\n\n#one', tiktokCaptionHasContent: true,
  platform: 'tiktok', status: 'delivered', deliveryState: 'ready_to_send', targetAccountBinding: target, createdAt: '2026-01-01', ...overrides,
});
const token = 'A'.repeat(43);
const handoff = (id: string) => ({ handoffId: `handoff-${id}`, url: `https://handoff.example.test/h/#${token}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('clientId', 'client-a'); localStorage.setItem('token', 'test');
  api.fetchDeliveredContents.mockResolvedValue([item('one')]);
  api.fetchContentDetail.mockResolvedValue(item('one'));
  api.createMobileCaptionHandoff.mockResolvedValue(handoff('one'));
  api.revokeMobileCaptionHandoff.mockResolvedValue(undefined);
  api.sendToTikTok.mockResolvedValue({}); api.refreshPublishStatus.mockResolvedValue(undefined); api.retryTikTok.mockResolvedValue(undefined);
  qr.toDataURL.mockResolvedValue('data:image/png;base64,offline-qr');
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { copyText: vi.fn().mockResolvedValue(undefined) } });
});

describe('Mobile Caption Handoff Queue workflow', () => {
  it('does not create on Queue load and disables the action without copyable caption text', async () => {
    api.fetchDeliveredContents.mockResolvedValue([item('empty', { caption: null, hashtags: [], tiktokCaptionText: '', tiktokCaptionHasContent: false })]);
    render(<QueueScreen />);
    const button = await screen.findByRole('button', { name: 'Open Caption on Phone' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(api.createMobileCaptionHandoff).not.toHaveBeenCalled();
  });

  it('creates only on click, renders an offline QR for only the HTTPS URL, and starts a 30 minute link countdown', async () => {
    const user = userEvent.setup();
    render(<QueueScreen />);
    await user.click(await screen.findByRole('button', { name: 'Open Caption on Phone' }));
    await waitFor(() => expect(api.createMobileCaptionHandoff).toHaveBeenCalledWith('one'));
    expect(qr.toDataURL).toHaveBeenCalledWith(handoff('one').url, expect.objectContaining({ errorCorrectionLevel: 'M' }));
    const encoded = qr.toDataURL.mock.calls[0][0];
    expect(encoded.startsWith('https://')).toBe(true);
    expect(encoded).not.toContain('Caption body');
    expect(encoded).not.toContain('one');
    expect((await screen.findByAltText('Secure mobile caption handoff QR code')).getAttribute('src')).toBe('data:image/png;base64,offline-qr');
    expect(screen.getByText('QR code expires in 30 minutes. Your content will remain available in PublishOS.')).toBeTruthy();
    expect(screen.getByText(/Expires in 29:5[89]/)).toBeTruthy();
    expect(api.sendToTikTok).not.toHaveBeenCalled();
    expect(window.electronAPI!.copyText).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.revokeMobileCaptionHandoff).not.toHaveBeenCalled();
  });

  it('allows phone handoff with an invalid send target while keeping Copy and Send independent', async () => {
    const user = userEvent.setup();
    api.fetchDeliveredContents.mockResolvedValue([item('invalid', { targetAccountBinding: null })]);
    render(<QueueScreen />);
    const phone = await screen.findByRole('button', { name: 'Open Caption on Phone' });
    expect((phone as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Target account required' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(phone);
    await waitFor(() => expect(api.createMobileCaptionHandoff).toHaveBeenCalledWith('invalid'));
    expect(api.sendToTikTok).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Copy Caption' }));
    expect(window.electronAPI!.copyText).toHaveBeenCalledWith('Caption body\n\n#one');
    expect(api.createMobileCaptionHandoff).toHaveBeenCalledTimes(1);
  });

  it('revokes by handoffId and regenerates a replacement without removing Queue content', async () => {
    const user = userEvent.setup();
    api.createMobileCaptionHandoff
      .mockResolvedValueOnce(handoff('old'))
      .mockResolvedValueOnce({ ...handoff('new'), url: `https://handoff.example.test/h/#${'B'.repeat(43)}` });
    render(<QueueScreen />);
    await user.click(await screen.findByRole('button', { name: 'Open Caption on Phone' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke phone link' }));
    await waitFor(() => expect(api.revokeMobileCaptionHandoff).toHaveBeenCalledWith('handoff-old'));
    expect(await screen.findByText('This phone link has been revoked.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Generate New QR Code' }));
    await waitFor(() => expect(api.createMobileCaptionHandoff).toHaveBeenCalledTimes(2));
    expect(qr.toDataURL).toHaveBeenLastCalledWith(expect.stringContaining(`#${'B'.repeat(43)}`), expect.any(Object));
    expect(screen.getByText('Title one')).toBeTruthy();
  });

  it('keeps Queue content available and offers regeneration after a phone link expires', async () => {
    const user = userEvent.setup();
    api.createMobileCaptionHandoff
      .mockResolvedValueOnce({ ...handoff('expired'), expiresAt: new Date(Date.now() - 1_000).toISOString() })
      .mockResolvedValueOnce(handoff('replacement'));
    render(<QueueScreen />);
    await user.click(await screen.findByRole('button', { name: 'Open Caption on Phone' }));
    expect(await screen.findByText('This QR code has expired.')).toBeTruthy();
    expect(screen.getByText('Title one')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Generate New QR Code' }));
    await waitFor(() => expect(api.createMobileCaptionHandoff).toHaveBeenCalledTimes(2));
    expect(await screen.findByAltText('Secure mobile caption handoff QR code')).toBeTruthy();
  });

  it('keeps state isolated by Queue card and reports API errors explicitly', async () => {
    const user = userEvent.setup();
    api.fetchDeliveredContents.mockResolvedValue([item('one'), item('two')]);
    api.createMobileCaptionHandoff.mockRejectedValueOnce(new Error('Link service unavailable')).mockResolvedValueOnce(handoff('two'));
    render(<QueueScreen />);
    const cards = await screen.findAllByText(/Title (one|two)/);
    expect(cards).toHaveLength(2);
    const buttons = screen.getAllByRole('button', { name: 'Open Caption on Phone' });
    await user.click(buttons[0]);
    expect((await screen.findByRole('alert')).textContent).toContain('Link service unavailable');
    await user.click(buttons[1]);
    const dialog = await screen.findByRole('dialog', { name: 'Caption handoff for Title two' });
    expect(within(dialog).getByAltText('Secure mobile caption handoff QR code')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Caption handoff for Title one' })).toBeNull();
  });
});
