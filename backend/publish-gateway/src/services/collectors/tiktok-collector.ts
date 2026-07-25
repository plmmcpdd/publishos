import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma';
import {
  getValidAccessToken,
  hasScope,
  markBindingExpired,
  markBindingReauthorizationRequired,
  TikTokTokenError,
  type TikTokTokenBinding,
} from '../tiktok-token';
import { upsertDailyMetrics, getMetricDate } from './utils';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';
const VIDEO_QUERY_ENDPOINT = `${TIKTOK_API_BASE}/video/query/`;
const VIDEO_LIST_ENDPOINT = `${TIKTOK_API_BASE}/video/list/`;
const REQUEST_TIMEOUT_MS = 15_000;

type TikTokVideoData = {
  id?: string;
  title?: string;
  create_time?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
};

type TikTokApiResponse = {
  data?: {
    videos?: TikTokVideoData[];
    cursor?: number;
    has_more?: boolean;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

export class CollectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function timeoutSignal(ms = REQUEST_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}

function safeErrorCode(data: TikTokApiResponse, fallback: string): string {
  const value = data.error?.code;
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : fallback;
}

async function parseResponse(response: Response): Promise<TikTokApiResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as TikTokApiResponse : {};
  } catch {
    return {};
  }
}

function hashResponse(data: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

async function queryVideoByIds(accessToken: string, videoIds: string[]): Promise<TikTokVideoData[]> {
  if (videoIds.length === 0) return [];

  const response = await fetch(VIDEO_QUERY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: {
        video_ids: videoIds,
      },
      fields: ['id', 'title', 'create_time', 'like_count', 'comment_count', 'share_count', 'view_count'],
    }),
    signal: timeoutSignal(),
  });

  const data = await parseResponse(response);
  if (!response.ok || (data.error?.code && data.error.code !== 'ok')) {
    const errorCode = safeErrorCode(data, `http_${response.status}`);
    throw new CollectorError(
      errorCode,
      `TikTok video query failed: ${errorCode}`,
      response.status === 429 || response.status >= 500,
    );
  }

  return data.data?.videos ?? [];
}

async function listVideos(accessToken: string, cursor?: number): Promise<{ videos: TikTokVideoData[]; cursor?: number; hasMore: boolean }> {
  const params = new URLSearchParams({
    fields: 'id,title,create_time,like_count,comment_count,share_count,view_count',
  });
  if (cursor) params.set('cursor', String(cursor));

  const response = await fetch(`${VIDEO_LIST_ENDPOINT}?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
    signal: timeoutSignal(),
  });

  const data = await parseResponse(response);
  if (!response.ok || (data.error?.code && data.error.code !== 'ok')) {
    const errorCode = safeErrorCode(data, `http_${response.status}`);
    throw new CollectorError(
      errorCode,
      `TikTok video list failed: ${errorCode}`,
      response.status === 429 || response.status >= 500,
    );
  }

  return {
    videos: data.data?.videos ?? [],
    cursor: data.data?.cursor,
    hasMore: data.data?.has_more ?? false,
  };
}

async function updateBindingCollectionStatus(
  bindingId: string,
  status: 'idle' | 'collecting' | 'success' | 'error',
  error?: { code: string; message: string },
): Promise<void> {
  const now = new Date();
  await prisma.accountBinding.update({
    where: { id: bindingId },
    data: {
      collectionStatus: status,
      lastCollectionAttemptAt: now,
      ...(status === 'success' ? { lastCollectionSuccessAt: now, collectionErrorCode: null, collectionErrorMessage: null } : {}),
      ...(status === 'error' && error ? { collectionErrorCode: error.code, collectionErrorMessage: error.message } : {}),
      ...(status === 'idle' ? { collectionErrorCode: null, collectionErrorMessage: null } : {}),
    },
  });
}

export async function collectTikTokMetrics(bindingId: string): Promise<void> {
  const binding = await prisma.accountBinding.findUnique({ where: { id: bindingId } });
  if (!binding || binding.platform !== 'tiktok' || binding.status !== 'active' || !binding.active) return;

  await updateBindingCollectionStatus(bindingId, 'collecting');

  try {
    // Check for video.list scope
    if (!hasScope(binding as TikTokTokenBinding, 'video.list')) {
      await markBindingReauthorizationRequired(bindingId, 'video.list scope required for metrics collection');
      await updateBindingCollectionStatus(bindingId, 'error', {
        code: 'scope_missing',
        message: 'video.list scope not granted. Reauthorization required.',
      });
      return;
    }

    const accessToken = await getValidAccessToken(binding as TikTokTokenBinding);

    // Find all published posts for this binding
    const publishedPosts = await prisma.publishedPost.findMany({
      where: {
        accountBindingId: bindingId,
        platform: 'tiktok',
        status: 'active',
      },
      include: {
        publishJob: {
          select: { id: true, contentId: true },
        },
      },
    });

    if (publishedPosts.length === 0) {
      await updateBindingCollectionStatus(bindingId, 'success');
      return;
    }

    // Query specific videos by ID first (more efficient)
    const videoIds = publishedPosts.map((p) => p.platformPostId);
    let videos: TikTokVideoData[] = [];

    try {
      videos = await queryVideoByIds(accessToken, videoIds);
    } catch (error) {
      if (error instanceof TikTokTokenError) {
        if (error.code === 'tiktok_connection_expired') {
          await markBindingExpired(bindingId);
        }
        await updateBindingCollectionStatus(bindingId, 'error', { code: error.code, message: error.message });
        return;
      }
      if (error instanceof CollectorError) {
        // If video/query fails, try video/list as fallback
        if (error.code === 'scope_not_authorized' || error.code === 'access_token_invalid') {
          await markBindingExpired(bindingId);
          await updateBindingCollectionStatus(bindingId, 'error', { code: error.code, message: error.message });
          return;
        }
        // Try video/list as fallback
        try {
          let cursor: number | undefined;
          let hasMore = true;
          while (hasMore) {
            const result = await listVideos(accessToken, cursor);
            videos.push(...result.videos);
            cursor = result.cursor;
            hasMore = result.hasMore;
          }
        } catch (listError) {
          if (listError instanceof TikTokTokenError) {
            await markBindingExpired(bindingId);
          }
          await updateBindingCollectionStatus(bindingId, 'error', {
            code: error.code,
            message: `Video query failed, list fallback also failed: ${error.message}`,
          });
          return;
        }
      } else {
        throw error;
      }
    }

    // Process each video
    const errors: string[] = [];
    for (const video of videos) {
      if (!video.id) continue;

      const publishedPost = publishedPosts.find((p) => p.platformPostId === video.id);
      if (!publishedPost) continue;

      try {
        const views = video.view_count ?? null;
        const likes = video.like_count ?? null;
        const comments = video.comment_count ?? null;
        const shares = video.share_count ?? null;

        // Calculate engagement rate only if we have valid numbers
        let engagementRate: number | null = null;
        if (views !== null && views > 0 && likes !== null && comments !== null && shares !== null) {
          engagementRate = (likes + comments + shares) / views;
        }

        await upsertDailyMetrics({
          clientId: binding.clientId,
          contentId: publishedPost.publishJob.contentId,
          publishJobId: publishedPost.publishJobId,
          publishedPostId: publishedPost.id,
          platform: 'tiktok',
          platformPostId: video.id,
          views,
          likes,
          comments,
          shares,
          engagementRate,
          source: 'tiktok_api',
          rawResponseHash: hashResponse(video),
        });

        // Update lastSeenAt
        await prisma.publishedPost.update({
          where: { id: publishedPost.id },
          data: { lastSeenAt: new Date() },
        });
      } catch (error) {
        errors.push(`${video.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0) {
      await updateBindingCollectionStatus(bindingId, 'error', {
        code: 'partial_failure',
        message: `${errors.length} video(s) failed to collect metrics`,
      });
    } else {
      await updateBindingCollectionStatus(bindingId, 'success');
    }
  } catch (error) {
    if (error instanceof TikTokTokenError) {
      if (error.code === 'tiktok_connection_expired') {
        await markBindingExpired(bindingId);
      }
      await updateBindingCollectionStatus(bindingId, 'error', { code: error.code, message: error.message });
      return;
    }
    if (error instanceof CollectorError) {
      await updateBindingCollectionStatus(bindingId, 'error', { code: error.code, message: error.message });
      return;
    }
    await updateBindingCollectionStatus(bindingId, 'error', {
      code: 'unknown_error',
      message: error instanceof Error ? error.message : 'Unknown error during collection',
    });
  }
}
