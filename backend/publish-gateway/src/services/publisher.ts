import { prisma } from '../lib/prisma';
import { activeJobStatuses, isTerminalJob, transitionContent, transitionJob } from '../domain/publishing-state';
import fs from 'fs';
import { localPathForStorageKey, normalizeLocalStorageKey } from './media-storage';

const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';
const PUBLIC_SERVER_BASE = process.env.PUBLIC_SERVER_BASE || 'http://104.238.181.32:3000';

function resolvePublicMediaUrl(url: string): string {
  if (url.startsWith('http')) return url;
  return `${PUBLIC_SERVER_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function refreshTikTokToken(bindingId: string, refreshToken: string): Promise<string> {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data: any = await res.json();
  if (data.error?.code && data.error.code !== 'ok') {
    throw new Error(`Token refresh failed: ${data.error.message || data.error.code}`);
  }

  const token = data.data?.access_token;
  if (!token) throw new Error('Token refresh failed: missing access_token');

  await prisma.accountBinding.update({
    where: { id: bindingId },
    data: {
      accessToken: token,
      refreshToken: data.data.refresh_token || refreshToken,
      expiresAt: data.data.expires_in ? new Date(Date.now() + data.data.expires_in * 1000) : undefined,
      status: 'active',
      active: true,
    },
  });

  return token;
}

async function getValidAccessToken(binding: {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
}): Promise<string> {
  if (!binding.accessToken) throw new Error('TikTok account is missing an access token');
  if (!binding.expiresAt || binding.expiresAt > new Date(Date.now() + 60_000)) return binding.accessToken;
  if (!binding.refreshToken) throw new Error('TikTok access token expired and no refresh token is available');
  return refreshTikTokToken(binding.id, binding.refreshToken);
}

export async function publishToTikTok(jobId: string): Promise<void> {
  const job = await prisma.publishJob.findUnique({
    where: { id: jobId },
    include: { content: true, accountBinding: true },
  });
  if (!job) return;

  try {
    if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
      throw new Error('TikTok credentials are not configured on server');
    }

    await prisma.$transaction(async (tx) => {
      await transitionJob(tx, jobId, 'pending', 'uploading', { errorMessage: null, errorDetail: null });
      await tx.jobHistory.create({ data: { jobId, status: 'uploading', changedBy: 'publisher', notes: 'Server publisher started' } });
    });

    const accessToken = await getValidAccessToken(job.accountBinding);
    const localKey = normalizeLocalStorageKey(job.content.videoUrl);
    const videoUrl = localKey ? undefined : resolvePublicMediaUrl(job.content.videoUrl);
    // Local media stays on disk; legacy/external references retain their existing fetch path.
    const videoBuffer = localKey
      ? fs.readFileSync(localPathForStorageKey(localKey))
      : await (async () => { const response = await fetch(videoUrl!); if (!response.ok) throw new Error(`Failed to download video from ${videoUrl}: ${response.status}`); return Buffer.from(await response.arrayBuffer()); })();
    const videoSize = videoBuffer.length;
    console.log(`[publish] Downloaded video: ${videoSize} bytes`);

    // Step 2: Init upload (FILE_UPLOAD via inbox, only needs video.upload scope)
    const MAX_CHUNK = 5 * 1024 * 1024; // 5MB max per chunk
    const chunkSize = Math.min(MAX_CHUNK, videoSize);
    const totalChunks = Math.ceil(videoSize / chunkSize);

    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: job.content.title || '',
          description: job.content.caption || job.content.description || '',
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      }),
    });

    const initData: any = await initRes.json();
    console.log(`[publish] TikTok init response:`, JSON.stringify(initData).slice(0, 500));

    if (!initRes.ok || initData.error?.code !== 'ok') {
      const errMsg = initData.error?.message || initData.message || JSON.stringify(initData);
      throw new Error(`TikTok init failed (${initRes.status}): ${errMsg}`);
    }

    const publishId = initData.data?.publish_id;
    const uploadUrl = initData.data?.upload_url;
    if (!publishId) throw new Error('TikTok init failed: missing publish_id');
    if (!uploadUrl) throw new Error('TikTok init failed: missing upload_url');

    console.log(`[publish] publishId=${publishId}, uploading to TikTok...`);

    // Step 3: Upload video to TikTok
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
      },
      body: videoBuffer,
    });

    const uploadText = await uploadRes.text();
    console.log(`[publish] TikTok upload response: ${uploadRes.status} ${uploadText.slice(0, 300)}`);

    if (!uploadRes.ok && uploadRes.status !== 200 && uploadRes.status !== 201) {
      throw new Error(`TikTok upload failed (${uploadRes.status}): ${uploadText.slice(0, 200)}`);
    }

    await prisma.$transaction(async (tx) => {
      await transitionJob(tx, jobId, 'uploading', 'publishing', { publishId });
      await tx.jobHistory.create({ data: { jobId, status: 'publishing', changedBy: 'publisher', notes: 'TikTok upload complete' } });
    });

    console.log(`[publish] publishId=${publishId}, polling status...`);
    await pollPublishStatus(jobId, job.contentId, publishId, accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[publish] jobId=${jobId} FAILED:`, message);
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.publishJob.findUnique({ where: { id: jobId }, select: { status: true } });
        if (!current || isTerminalJob(current.status)) return;
        await transitionJob(tx, jobId, activeJobStatuses, 'failed', { failedAt: new Date(), errorMessage: message, errorDetail: message, retryCount: { increment: 1 } });
        await transitionContent(tx, job.contentId, 'delivered', 'failed');
        await tx.jobHistory.create({ data: { jobId, status: 'failed', changedBy: 'publisher', notes: 'Server publisher failed' } });
      });
    } catch (failureError) {
      const current = await prisma.publishJob.findUnique({ where: { id: jobId }, select: { status: true } });
      if (current && isTerminalJob(current.status)) return;
      throw failureError;
    }
  }
}

async function pollPublishStatus(jobId: string, contentId: string, publishId: string, accessToken: string): Promise<void> {
  const maxRetries = 30;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    const statusRes = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    });

    const statusData: any = await statusRes.json();
    if (!statusRes.ok || (statusData.error?.code && statusData.error.code !== 'ok')) {
      throw new Error(`TikTok status failed: ${statusData.error?.message || JSON.stringify(statusData)}`);
    }

    const status = statusData.data?.status;
    if (status === 'PUBLISH_COMPLETE') {
      const publishedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await transitionJob(tx, jobId, 'publishing', 'published', { publishedAt, platformPostId: publishId, errorMessage: null, errorDetail: null });
        await transitionContent(tx, contentId, 'delivered', 'published', { publishedAt });
        await tx.jobHistory.create({ data: { jobId, status: 'published', changedBy: 'publisher', notes: 'TikTok publish complete' } });
      });
      return;
    }

    if (status === 'FAILED') {
      throw new Error(`TikTok publish failed: ${JSON.stringify(statusData.data)}`);
    }
  }

  throw new Error('TikTok publish timeout after 5 minutes');
}
