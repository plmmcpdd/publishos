import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Mock prisma before importing collector
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    accountBinding: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    publishedPost: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    performanceMetrics: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock tiktok-token module
vi.mock('../src/services/tiktok-token', () => ({
  getValidAccessToken: vi.fn(),
  hasScope: vi.fn(),
  markBindingExpired: vi.fn(),
  markBindingReauthorizationRequired: vi.fn(),
  TikTokTokenError: class TikTokTokenError extends Error {
    constructor(
      public code: string,
      message: string,
      public retryable = false,
      public temporary = false,
    ) {
      super(message);
    }
  },
}));

import { collectTikTokMetrics } from '../src/services/collectors/tiktok-collector';
import { prisma } from '../src/lib/prisma';
import { getValidAccessToken, hasScope, markBindingReauthorizationRequired } from '../src/services/tiktok-token';

const mockBinding = {
  id: 'binding-1',
  clientId: 'client-1',
  platform: 'tiktok',
  status: 'active',
  active: true,
  scope: 'user.info.basic,video.upload,video.list',
  accessToken: 'test-token',
};

const mockPublishedPost = {
  id: 'post-1',
  publishJobId: 'job-1',
  accountBindingId: 'binding-1',
  platform: 'tiktok',
  platformPostId: 'video-123',
  status: 'active',
  publishJob: {
    id: 'job-1',
    contentId: 'content-1',
  },
};

describe('Phase 2A: TikTok collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.accountBinding.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockBinding);
    (prisma.publishedPost.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([mockPublishedPost]);
    (prisma.accountBinding.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.publishedPost.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.performanceMetrics.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.performanceMetrics.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.performanceMetrics.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (getValidAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue('valid-token');
    (hasScope as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (markBindingReauthorizationRequired as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('skips collection when binding is not found', async () => {
    (prisma.accountBinding.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await collectTikTokMetrics('nonexistent');
    expect(prisma.publishedPost.findMany).not.toHaveBeenCalled();
  });

  it('skips collection when binding is not active', async () => {
    (prisma.accountBinding.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockBinding,
      active: false,
    });
    await collectTikTokMetrics('binding-1');
    expect(prisma.publishedPost.findMany).not.toHaveBeenCalled();
  });

  it('marks reauthorization required when video.list scope is missing', async () => {
    (hasScope as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await collectTikTokMetrics('binding-1');
    expect(markBindingReauthorizationRequired).toHaveBeenCalledWith(
      'binding-1',
      'video.list scope required for metrics collection',
    );
    expect(getValidAccessToken).not.toHaveBeenCalled();
  });

  it('skips collection when no published posts exist', async () => {
    (prisma.publishedPost.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await collectTikTokMetrics('binding-1');
    // getValidAccessToken is called to check scope, but no metrics are collected
    expect(prisma.performanceMetrics.create).not.toHaveBeenCalled();
  });
});
