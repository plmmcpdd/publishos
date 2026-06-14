import { prisma } from '../lib/prisma';

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

    await prisma.publishJob.update({
      where: { id: jobId },
      data: { status: 'uploading', errorMessage: null, errorDetail: null },
    });

    const accessToken = await getValidAccessToken(job.accountBinding);
    const videoUrl = resolvePublicMediaUrl(job.content.videoUrl);

    console.log(`[publish] jobId=${jobId} videoUrl=${videoUrl}`);

    // Step 1: Download video from our server
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      throw new Error(`Failed to download video from ${videoUrl}: ${videoRes.status}`);
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const videoSize = videoBuffer.length;
    console.log(`[publish] Downloaded video: ${videoSize} bytes`);

    // Step 2: Init upload (UPLOAD_FROM_DEVICE requires video.upload scope)
    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: job.content.title || '',
          description: job.content.caption || job.content.description || '',
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'UPLOAD_FROM_DEVICE',
          video_size: videoSize,
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

    console.log(`[publish] publishId=${publishId}, uploadUrl=${uploadUrl}`);

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

    if (!uploadRes.ok && uploadRes.status !== 201) {
      throw new Error(`TikTok upload failed (${uploadRes.status}): ${uploadText.slice(0, 200)}`);
    }

    await prisma.publishJob.update({
      where: { id: jobId },
      data: { publishId, status: 'publishing' },
    });

    console.log(`[publish] publishId=${publishId}, polling status...`);
    await pollPublishStatus(jobId, job.contentId, publishId, accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[publish] jobId=${jobId} FAILED:`, message);
    await prisma.publishJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        failedAt: new Date(),
        errorMessage: message,
        errorDetail: message,
        retryCount: { increment: 1 },
      },
    });
    await prisma.content.update({
      where: { id: job.contentId },
      data: { status: 'failed' },
    });
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
      await prisma.publishJob.update({
        where: { id: jobId },
        data: {
          status: 'published',
          publishedAt,
          platformPostId: publishId,
          errorMessage: null,
          errorDetail: null,
        },
      });
      await prisma.content.update({
        where: { id: contentId },
        data: { status: 'published', publishedAt },
      });
      return;
    }

    if (status === 'FAILED') {
      throw new Error(`TikTok publish failed: ${JSON.stringify(statusData.data)}`);
    }
  }

  throw new Error('TikTok publish timeout after 5 minutes');
}
