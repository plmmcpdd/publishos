import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContentList from './ContentList';

const api = vi.hoisted(() => ({
  fetchContents: vi.fn(), fetchClients: vi.fn(), fetchTikTokBindings: vi.fn(), createContent: vi.fn(),
  approveContent: vi.fn(), deliverContent: vi.fn(), deleteContent: vi.fn(), uploadVideo: vi.fn(),
}));
vi.mock('../api', () => ({ ...api, firstPlatform: (item: { platform?: string }) => item.platform || 'tiktok' }));

const validBinding = { id: 'binding-a', platform: 'tiktok', username: 'alpha', accountUsername: 'alpha', active: true, status: 'active', grantedScopes: ['video.upload', 'video.list'], createdAt: '', updatedAt: '' };
let contentSequence = 0;
const content = (status: string, targetAccountBinding: typeof validBinding | null = validBinding) => ({ id: `content-${status}-${++contentSequence}`, title: status, description: 'desc', status, platform: 'tiktok', client: { id: 'client-a', name: 'Client A' }, targetAccountBinding, createdAt: '2026-01-01T00:00:00Z' });

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  contentSequence = 0;
  api.fetchContents.mockResolvedValue([content('draft'), content('pending_review'), content('approved'), content('failed'), content('delivered'), content('published'), content('draft', null)]);
  api.fetchClients.mockResolvedValue([{ id: 'client-a', name: 'Client A', email: 'a@test.local', active: true }]);
  api.fetchTikTokBindings.mockResolvedValue([validBinding, { ...validBinding, id: 'revoked', username: 'revoked', status: 'revoked' }, { ...validBinding, id: 'scope', username: 'scope', grantedScopes: [] }]);
  api.deliverContent.mockResolvedValue(undefined); api.approveContent.mockResolvedValue(undefined); api.createContent.mockResolvedValue({});
});

describe('ContentList account-targeted interactions', () => {
  it('renders state-gated actions and target summaries', async () => {
    render(<ContentList />);
    await waitFor(() => expect(api.fetchContents).toHaveBeenCalled());
    expect(screen.getAllByText('提交审核')).toHaveLength(2);
    expect(screen.getAllByText('批准')).toHaveLength(1);
    expect(screen.getAllByText('推送给客户')).toHaveLength(1);
    expect(screen.getAllByText('目标账号：@alpha')).toHaveLength(6);
    expect(screen.getByText('目标账号：未指定')).toBeTruthy();
  });

  it('disables repeated delivery, surfaces backend errors, and refreshes only after success', async () => {
    const user = userEvent.setup(); render(<ContentList />); await waitFor(() => expect(api.fetchContents).toHaveBeenCalled());
    let resolve!: () => void; api.deliverContent.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const button = screen.getByText('推送给客户'); await user.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true); await user.click(button); expect(api.deliverContent).toHaveBeenCalledTimes(1);
    resolve(); await waitFor(() => expect(api.fetchContents).toHaveBeenCalledTimes(2));
    api.deliverContent.mockRejectedValueOnce(new Error('target_account_mismatch'));
    await user.click(screen.getByText('推送给客户')); await screen.findByText('target_account_mismatch');
  });

  it('loads bindings for the selected client, clears stale selection, and sends an owned target', async () => {
    const user = userEvent.setup(); render(<ContentList />); await waitFor(() => expect(api.fetchContents).toHaveBeenCalled());
    await user.click(screen.getByText('+ 创建内容'));
    await user.type(screen.getByPlaceholderText('标题'), 'New title'); await user.type(screen.getByPlaceholderText('描述'), 'New description');
    await user.selectOptions(screen.getByDisplayValue('选择客户'), 'client-a');
    await waitFor(() => expect(api.fetchTikTokBindings).toHaveBeenCalledWith('client-a'));
    const target = screen.getByDisplayValue('选择目标 TikTok 账号') as HTMLSelectElement;
    expect((target.querySelector('option[value="revoked"]') as HTMLOptionElement).disabled).toBe(true);
    expect((target.querySelector('option[value="scope"]') as HTMLOptionElement).disabled).toBe(true);
    await user.selectOptions(target, 'binding-a');
    await user.click(screen.getByText('创建草稿'));
    await waitFor(() => expect(api.createContent).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-a', targetAccountBindingId: 'binding-a' })));
  });

  it('clears TikTok targeting when switching platform and requires reselection on return', async () => {
    const user = userEvent.setup(); render(<ContentList />); await waitFor(() => expect(api.fetchContents).toHaveBeenCalled()); await user.click(screen.getByText('+ 创建内容'));
    await user.selectOptions(screen.getByDisplayValue('选择客户'), 'client-a'); await screen.findByDisplayValue('选择目标 TikTok 账号');
    await user.selectOptions(screen.getByDisplayValue('选择目标 TikTok 账号'), 'binding-a');
    const platform = screen.getAllByRole('combobox')[0]; await user.selectOptions(platform, 'instagram');
    expect(screen.queryByDisplayValue('选择目标 TikTok 账号')).toBeNull();
    await user.selectOptions(platform, 'tiktok'); await screen.findByDisplayValue('选择目标 TikTok 账号');
    expect((screen.getByDisplayValue('选择目标 TikTok 账号') as HTMLSelectElement).value).toBe('');
  });
});
