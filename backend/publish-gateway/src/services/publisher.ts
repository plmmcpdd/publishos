import crypto from 'node:crypto';
import fs from 'node:fs';
import { prisma } from '../lib/prisma';
import {
  activeJobStatuses,
  isTerminalJob,
  transitionContent,
  transitionJob,
} from '../domain/publishing-state';
import { loadMediaConfig } from '../config/security';
import {
  localPathForStorageKey,
  mediaMimeFromKey,
  normalizeLocalStorageKey,
} from './media-storage';
import { safeDownloadExternalMedia } from './safe-http-fetch';
import {
  getValidAccessToken,
  hasScope,
  markBindingExpired,
  TikTokTokenError,
  type TikTokTokenBinding,
} from './tiktok-token';


const TIKTOK_INIT_ENDPOINT = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const TIKTOK_STATUS_ENDPOINT = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
const MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const UPLOAD_URL_TTL_MS = 60 * 60 * 1000;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const PROCESSING_RECHECK_MS = 30 * 1000;
const INBOX_RECHECK_MS = 5 * 60 * 1000;
const MAX_STATUS_BACKOFF_MS = 15 * 60 * 1000;

type TikTokResponse = {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  code?: string;
  message?: string;
};

class PublisherError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly temporary = false,
  ) {
    super(message);
  }
}

function timeoutSignal(milliseconds = 30_000): AbortSignal {
  return AbortSignal.timeout(milliseconds);
}

function publisherCredentials(): { key: string; secret: string } {
  const key = process.env.TIKTOK_CLIENT_KEY || '';
  const secret = process.env.TIKTOK_CLIENT_SECRET || '';
  if (!key || !secret) {
    throw new PublisherError('tiktok_not_configured', 'TikTok credentials are not configured on the server');
  }
  return { key, secret };
}

function statusDelay(failures: number): number {
  return Math.min(PROCESSING_RECHECK_MS * 2 ** Math.max(0, failures - 1), MAX_STATUS_BACKOFF_MS);
}

function safeUpstreamCode(data: TikTokResponse, fallback: string): string {
  const value = data.error?.code || data.code;
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : fallback;
}

function safeFailureReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^[a-zA-Z0-9_.-]{1,120}$/.test(value) ? value : undefined;
}

async function getPublisherAccessToken(binding: TikTokTokenBinding): Promise<string> {
  if (!hasScope(binding, 'video.upload')) {
    throw new PublisherError(
      'tiktok_scope_missing',
      'TikTok connection does not grant video.upload. Reconnect TikTok and retry.',
      true,
    );
  }
  try {
    return await getValidAccessToken(binding);
  } catch (error) {
    if (error instanceof TikTokTokenError) {
      throw new PublisherError(error.code, error.message, error.retryable, error.temporary);
    }
    throw error;
  }
}

function safePublisherMessage(code: string, operation: 'init' | 'upload' | 'status'): string {
  if (code === 'spam_risk_too_many_pending_share') {
    return 'TikTok has reached the pending draft limit for this account. Finish or remove pending drafts before retrying.';
  }
  if (operation === 'init') return 'TikTok could not initialize the draft upload.';
  if (operation === 'upload') return 'TikTok could not receive the video upload.';
  return 'TikTok status is temporarily unavailable.';
}

async function responseJson(response: Response): Promise<TikTokResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as TikTokResponse : {};
  } catch {
    return {};
  }
}

function publicMediaUrl(reference: string): string {
  if (/^https?:\/\//iu.test(reference)) return reference;
  const base = process.env.PUBLIC_SERVER_BASE || process.env.PUBLIC_BASE_URL || '';
  if (!base) throw new PublisherError('media_unavailable', 'The video media reference cannot be resolved.');
  return new URL(reference, base).toString();
}

async function readVideo(reference: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const localKey = normalizeLocalStorageKey(reference);
  const config = loadMediaConfig();
  const buffer = localKey
    ? fs.readFileSync(localPathForStorageKey(localKey))
    : await safeDownloadExternalMedia(publicMediaUrl(reference), config.videoMaxBytes);
  if (!buffer.length) throw new PublisherError('media_empty', 'The video file is empty.');
  if (buffer.length > config.videoMaxBytes) throw new PublisherError('media_too_large', 'The video exceeds the configured upload limit.');
  const mimeType = localKey
    ? mediaMimeFromKey(localKey)
    : reference.toLowerCase().includes('.mov')
      ? 'video/quicktime'
      : reference.toLowerCase().includes('.webm')
        ? 'video/webm'
        : 'video/mp4';
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(mimeType)) {
    throw new PublisherError('media_type_not_allowed', 'The video format is not supported by TikTok upload.');
  }
  return { buffer, mimeType };
}

export function planTikTokChunks(videoSize: number): {
  chunkSize: number;
  totalChunkCount: number;
  ranges: Array<{ start: number; end: number }>;
} {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) {
    throw new PublisherError('media_empty', 'The video file is empty.');
  }
  if (videoSize <= MAX_CHUNK_BYTES) {
    return { chunkSize: videoSize, totalChunkCount: 1, ranges: [{ start: 0, end: videoSize - 1 }] };
  }

  const totalChunkCount = Math.floor(videoSize / MAX_CHUNK_BYTES);
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < totalChunkCount; index += 1) {
    const start = index * MAX_CHUNK_BYTES;
    const end = index === totalChunkCount - 1 ? videoSize - 1 : start + MAX_CHUNK_BYTES - 1;
    ranges.push({ start, end });
  }
  const lastSize = ranges[ranges.length - 1].end - ranges[ranges.length - 1].start + 1;
  if (lastSize < MIN_CHUNK_BYTES || lastSize > 2 * MAX_CHUNK_BYTES) {
    throw new PublisherError('media_chunk_plan_invalid', 'The video cannot be split into valid TikTok upload chunks.');
  }
  return { chunkSize: MAX_CHUNK_BYTES, totalChunkCount, ranges };
}

async function acquireLease(jobId: string): Promise<string | undefined> {
  const token = crypto.randomUUID();
  const now = new Date();
  const result = await prisma.publishJob.updateMany({
    where: {
      id: jobId,
      status: { in: [...activeJobStatuses] },
      OR: [{ workerLeaseUntil: null }, { workerLeaseUntil: { lt: now } }],
    },
    data: {
      workerLeaseToken: token,
      workerLeaseUntil: new Date(now.getTime() + DEFAULT_LEASE_MS),
    },
  });
  return result.count === 1 ? token : undefined;
}

async function releaseLease(jobId: string, token: string): Promise<void> {
  await prisma.publishJob.updateMany({
    where: { id: jobId, workerLeaseToken: token },
    data: { workerLeaseToken: null, workerLeaseUntil: null },
  });
}

async function failJob(
  jobId: string,
  contentId: string,
  error: PublisherError,
  details?: { platformStatus?: string; failReason?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.publishJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!current || isTerminalJob(current.status)) return;
    const now = new Date();
    await transitionJob(tx, jobId, activeJobStatuses, 'failed', {
      failedAt: now,
      errorCode: error.code,
      errorMessage: error.message,
      errorDetail: null,
      retryable: error.retryable,
      retryCount: { increment: 1 },
      deliveryStage: 'failed',
      lastPlatformStatus: details?.platformStatus,
      lastStatusError: details?.failReason,
      nextStatusCheckAt: null,
      workerLeaseToken: null,
      workerLeaseUntil: null,
    });
    const content = await tx.content.findUnique({ where: { id: contentId }, select: { status: true } });
    if (content?.status === 'delivered') await transitionContent(tx, contentId, 'delivered', 'failed');
    await tx.jobHistory.create({
      data: { jobId, status: 'failed', changedBy: 'tiktok_inbox_worker', notes: error.code },
    });
    await tx.auditLog.create({
      data: {
        action: 'tiktok_delivery_failed',
        actorType: 'system',
        actorId: 'tiktok_inbox_worker',
        targetType: 'publish_job',
        targetId: jobId,
        details: JSON.stringify({
          code: error.code,
          retryable: error.retryable,
          platformStatus: details?.platformStatus,
          failReason: details?.failReason,
        }),
      },
    });
  });
}

async function deferJob(jobId: string, error: PublisherError): Promise<void> {
  const current = await prisma.publishJob.findUnique({
    where: { id: jobId },
    select: { statusCheckFailures: true, status: true },
  });
  if (!current || isTerminalJob(current.status)) return;
  const failures = current.statusCheckFailures + 1;
  const nextStatusCheckAt = new Date(Date.now() + statusDelay(failures));
  await prisma.$transaction(async (tx) => {
    const updated = await tx.publishJob.updateMany({
      where: { id: jobId, status: { in: [...activeJobStatuses] } },
      data: {
        statusCheckFailures: failures,
        lastStatusError: error.code,
        errorCode: error.code,
        errorMessage: error.message,
        retryable: true,
        nextStatusCheckAt,
      },
    });
    if (updated.count !== 1) return;
    await tx.jobHistory.create({
      data: {
        jobId,
        status: 'reconciliation_deferred',
        changedBy: 'tiktok_inbox_worker',
        notes: error.code,
      },
    });
  });
}

async function initializeUpload(jobId: string, video: Buffer): Promise<void> {
  const plan = planTikTokChunks(video.length);
  const attemptedAt = new Date();
  const marked = await prisma.publishJob.updateMany({
    where: {
      id: jobId,
      status: 'uploading',
      publishId: null,
      initializationAttemptedAt: null,
    },
    data: {
      initializationAttemptedAt: attemptedAt,
      deliveryStage: 'tiktok_initializing',
    },
  });
  if (marked.count !== 1) {
    const current = await prisma.publishJob.findUnique({
      where: { id: jobId },
      select: { publishId: true, initializationAttemptedAt: true },
    });
    if (current?.publishId) return;
    throw new PublisherError(
      'tiktok_init_outcome_unknown',
      'TikTok initialization outcome is unknown. Automatic re-initialization is blocked to prevent a duplicate draft.',
    );
  }

  const job = await prisma.publishJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { accountBinding: true },
  });
  const accessToken = await getPublisherAccessToken(job.accountBinding);
  let response: Response;
  try {
    response = await fetch(TIKTOK_INIT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: video.length,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunkCount,
        },
      }),
      signal: timeoutSignal(),
    });
  } catch {
    throw new PublisherError(
      'tiktok_init_outcome_unknown',
      'TikTok initialization outcome is unknown. Automatic re-initialization is blocked to prevent a duplicate draft.',
    );
  }

  const data = await responseJson(response);
  const upstreamCode = safeUpstreamCode(data, response.ok ? 'invalid_response' : `http_${response.status}`);
  if (!response.ok || (data.error?.code && data.error.code !== 'ok')) {
    throw new PublisherError(
      upstreamCode === 'rate_limit_exceeded' ? 'tiktok_rate_limited' : `tiktok_init_${upstreamCode}`,
      safePublisherMessage(upstreamCode, 'init'),
      response.status === 429 || response.status >= 500,
    );
  }
  const publishId = data.data?.publish_id;
  const uploadUrl = data.data?.upload_url;
  if (typeof publishId !== 'string' || !publishId || typeof uploadUrl !== 'string' || !uploadUrl) {
    throw new PublisherError('tiktok_init_invalid_response', 'TikTok initialization returned an invalid response.');
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.publishJob.updateMany({
      where: { id: jobId, status: 'uploading', publishId: null },
      data: {
        publishId,
        uploadUrl,
        uploadExpiresAt: new Date(Date.now() + UPLOAD_URL_TTL_MS),
        uploadedBytes: 0,
        deliveryStage: 'uploading_video',
        errorCode: null,
        errorMessage: null,
        errorDetail: null,
      },
    });
    if (updated.count !== 1) {
      const existing = await tx.publishJob.findUnique({ where: { id: jobId }, select: { publishId: true } });
      if (existing?.publishId === publishId) return;
      throw new PublisherError('duplicate_publish_id', 'A different TikTok publish identifier is already stored.');
    }
    await tx.jobHistory.create({
      data: {
        jobId,
        status: 'tiktok_upload_initialized',
        changedBy: 'tiktok_inbox_worker',
        notes: 'Official Inbox FILE_UPLOAD initialized; publish_id persisted before media upload',
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'tiktok_inbox_initialized',
        actorType: 'system',
        actorId: 'tiktok_inbox_worker',
        targetType: 'publish_job',
        targetId: jobId,
        details: JSON.stringify({ publishId, source: 'FILE_UPLOAD' }),
      },
    });
  });
}

async function uploadVideo(jobId: string, video: Buffer, mimeType: string): Promise<void> {
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: jobId } });
  if (!job.publishId || !job.uploadUrl || !job.uploadExpiresAt) {
    throw new PublisherError('tiktok_upload_state_missing', 'TikTok upload state is incomplete.');
  }
  if (job.uploadExpiresAt <= new Date()) {
    throw new PublisherError(
      'tiktok_upload_url_expired',
      'TikTok upload URL expired before the video upload completed.',
    );
  }

  const plan = planTikTokChunks(video.length);
  for (const range of plan.ranges) {
    if (range.end < job.uploadedBytes) continue;
    const start = Math.max(range.start, job.uploadedBytes);
    if (start !== range.start) {
      throw new PublisherError(
        'tiktok_upload_offset_uncertain',
        'TikTok upload offset is uncertain. Automatic re-upload is blocked to prevent corrupting the draft.',
      );
    }
    const chunk = video.subarray(range.start, range.end + 1);
    let response: Response;
    try {
      response = await fetch(job.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${range.start}-${range.end}/${video.length}`,
        },
        body: chunk as unknown as BodyInit,
        signal: timeoutSignal(120_000),
      });
    } catch {
      throw new PublisherError('tiktok_upload_unavailable', safePublisherMessage('network', 'upload'), true, true);
    }

    const isFinal = range.end === video.length - 1;
    const accepted = isFinal
      ? response.status === 200 || response.status === 201
      : response.status === 206;
    if (!accepted) {
      const data = await responseJson(response);
      const upstreamCode = safeUpstreamCode(data, `http_${response.status}`);
      throw new PublisherError(
        upstreamCode === 'rate_limit_exceeded' ? 'tiktok_rate_limited' : `tiktok_upload_${upstreamCode}`,
        safePublisherMessage(upstreamCode, 'upload'),
        response.status === 429 || response.status >= 500,
        response.status === 429 || response.status >= 500,
      );
    }

    await prisma.publishJob.updateMany({
      where: { id: jobId, status: 'uploading', publishId: job.publishId },
      data: { uploadedBytes: range.end + 1, deliveryStage: 'uploading_video' },
    });
  }

  const completedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await transitionJob(tx, jobId, 'uploading', 'publishing', {
      uploadCompletedAt: completedAt,
      uploadUrl: null,
      uploadExpiresAt: null,
      deliveryStage: 'tiktok_processing',
      nextStatusCheckAt: completedAt,
      errorCode: null,
      errorMessage: null,
      errorDetail: null,
      retryable: false,
    });
    await tx.jobHistory.create({
      data: {
        jobId,
        status: 'tiktok_processing',
        changedBy: 'tiktok_inbox_worker',
        notes: 'Video upload complete; TikTok processing started',
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'tiktok_upload_completed',
        actorType: 'system',
        actorId: 'tiktok_inbox_worker',
        targetType: 'publish_job',
        targetId: jobId,
        details: JSON.stringify({ publishId: job.publishId, uploadedBytes: video.length }),
      },
    });
  });
}

async function applyTikTokStatus(
  jobId: string,
  status: string,
  data: Record<string, unknown>,
): Promise<void> {
  const normalizedStatus = status.slice(0, 80);
  if (normalizedStatus === 'PUBLISH_COMPLETE') {
    await prisma.$transaction(async (tx) => {
      const job = await tx.publishJob.findUnique({
        where: { id: jobId },
        include: { content: true },
      });
      if (!job || job.status === 'published') return;
      if (isTerminalJob(job.status)) return;
      const publishedAt = new Date();
      const postIds = Array.isArray(data.publicly_available_post_id)
        ? data.publicly_available_post_id
        : Array.isArray((data as any).publicaly_available_post_id)
          ? (data as any).publicaly_available_post_id
          : [];
      const platformPostId = postIds.length ? String(postIds[0]) : job.publishId ?? null;
      await transitionJob(tx, jobId, activeJobStatuses, 'published', {
        publishedAt,
        platformPostId,
        deliveryStage: 'published',
        lastPlatformStatus: normalizedStatus,
        lastStatusCheckedAt: publishedAt,
        nextStatusCheckAt: null,
        statusCheckFailures: 0,
        lastStatusError: null,
        errorCode: null,
        errorMessage: null,
        errorDetail: null,
        failedAt: null,
        retryable: false,
        uploadUrl: null,
        uploadExpiresAt: null,
      });
      if (job.content.status === 'delivered') {
        await transitionContent(tx, job.contentId, 'delivered', 'published', { publishedAt });
      }
      await tx.jobHistory.create({
        data: {
          jobId,
          status: 'published',
          changedBy: 'tiktok_inbox_worker',
          notes: 'TikTok PUBLISH_COMPLETE received after customer final publish',
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'tiktok_publish_completed',
          actorType: 'system',
          actorId: 'tiktok_inbox_worker',
          targetType: 'publish_job',
          targetId: jobId,
          details: JSON.stringify({ publishId: job.publishId, platformPostId }),
        },
      });
    });
    return;
  }

  if (normalizedStatus === 'FAILED') {
    const job = await prisma.publishJob.findUnique({
      where: { id: jobId },
      select: { contentId: true, status: true },
    });
    if (!job || job.status === 'published' || isTerminalJob(job.status)) return;
    const failReason = safeFailureReason(data.fail_reason);
    await failJob(
      jobId,
      job.contentId,
      new PublisherError(
        'tiktok_official_failed',
        failReason ? `TikTok reported a failed draft delivery (${failReason}).` : 'TikTok reported a failed draft delivery.',
        failReason === 'internal',
      ),
      { platformStatus: normalizedStatus, failReason },
    );
    return;
  }

  const now = new Date();
  if (normalizedStatus === 'SEND_TO_USER_INBOX') {
    await prisma.$transaction(async (tx) => {
      const current = await tx.publishJob.findUnique({
        where: { id: jobId },
        select: { status: true, inboxDeliveredAt: true, publishId: true },
      });
      if (!current || current.status === 'published' || isTerminalJob(current.status)) return;
      const firstDelivery = !current.inboxDeliveredAt;
      await tx.publishJob.update({
        where: { id: jobId },
        data: {
          deliveryStage: 'waiting_for_final_tiktok_publish',
          inboxDeliveredAt: current.inboxDeliveredAt || now,
          lastPlatformStatus: normalizedStatus,
          lastStatusCheckedAt: now,
          nextStatusCheckAt: new Date(now.getTime() + INBOX_RECHECK_MS),
          statusCheckFailures: 0,
          lastStatusError: null,
          errorCode: null,
          errorMessage: null,
          retryable: false,
        },
      });
      if (firstDelivery) {
        await tx.jobHistory.create({
          data: {
            jobId,
            status: 'sent_to_tiktok_inbox',
            changedBy: 'tiktok_inbox_worker',
            notes: 'TikTok SEND_TO_USER_INBOX; waiting for customer final publish in TikTok App',
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'tiktok_inbox_delivered',
            actorType: 'system',
            actorId: 'tiktok_inbox_worker',
            targetType: 'publish_job',
            targetId: jobId,
            details: JSON.stringify({ publishId: current.publishId, requiresCustomerFinalPublish: true }),
          },
        });
      }
    });
    return;
  }

  const knownProcessing = normalizedStatus === 'PROCESSING_UPLOAD' || normalizedStatus === 'PROCESSING_DOWNLOAD';
  await prisma.$transaction(async (tx) => {
    const current = await tx.publishJob.findUnique({
      where: { id: jobId },
      select: { status: true, lastPlatformStatus: true },
    });
    if (!current || isTerminalJob(current.status)) return;
    await tx.publishJob.update({
      where: { id: jobId },
      data: {
        deliveryStage: 'tiktok_processing',
        lastPlatformStatus: normalizedStatus,
        lastStatusCheckedAt: now,
        nextStatusCheckAt: new Date(now.getTime() + (knownProcessing ? PROCESSING_RECHECK_MS : 60_000)),
        statusCheckFailures: 0,
        lastStatusError: knownProcessing ? null : 'unknown_platform_status',
        errorCode: null,
        errorMessage: null,
        retryable: false,
      },
    });
    if (!knownProcessing && current.lastPlatformStatus !== normalizedStatus) {
      await tx.jobHistory.create({
        data: {
          jobId,
          status: 'tiktok_status_unknown',
          changedBy: 'tiktok_inbox_worker',
          notes: normalizedStatus,
        },
      });
    }
  });
}

async function fetchPublishStatus(jobId: string): Promise<void> {
  const job = await prisma.publishJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { accountBinding: true },
  });
  if (!job.publishId) {
    throw new PublisherError('publish_id_missing', 'TikTok publish identifier is missing.');
  }
  const accessToken = await getPublisherAccessToken(job.accountBinding);
  let response: Response;
  try {
    response = await fetch(TIKTOK_STATUS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: job.publishId }),
      signal: timeoutSignal(),
    });
  } catch {
    await deferJob(
      jobId,
      new PublisherError('tiktok_status_unavailable', safePublisherMessage('network', 'status'), true, true),
    );
    return;
  }

  const data = await responseJson(response);
  const upstreamCode = safeUpstreamCode(data, response.ok ? 'invalid_response' : `http_${response.status}`);
  if (!response.ok || (data.error?.code && data.error.code !== 'ok')) {
    if (upstreamCode === 'access_token_invalid' || upstreamCode === 'scope_not_authorized') {
      await markBindingExpired(job.accountBindingId);
      await deferJob(
        jobId,
        new PublisherError('tiktok_connection_expired', safePublisherMessage(upstreamCode, 'status'), true),
      );
      return;
    }
    await deferJob(
      jobId,
      new PublisherError(
        upstreamCode === 'rate_limit_exceeded' ? 'tiktok_rate_limited' : 'tiktok_status_unavailable',
        safePublisherMessage(upstreamCode, 'status'),
        true,
        response.status === 429 || response.status >= 500,
      ),
    );
    return;
  }

  const status = data.data?.status;
  if (typeof status !== 'string' || !status) {
    await deferJob(
      jobId,
      new PublisherError('tiktok_status_invalid_response', 'TikTok status returned an invalid response.', true, true),
    );
    return;
  }
  await applyTikTokStatus(jobId, status, data.data || {});
}

async function validateJobBoundary(jobId: string) {
  const job = await prisma.publishJob.findUnique({
    where: { id: jobId },
    include: { content: true, accountBinding: true },
  });
  if (!job) return undefined;
  if (job.platform !== 'tiktok' || job.accountBinding.platform !== 'tiktok') {
    throw new PublisherError('tiktok_binding_invalid', 'Publish job is not bound to TikTok.');
  }
  if (job.content.clientId !== job.accountBinding.clientId) {
    throw new PublisherError('tenant_mismatch', 'Content and TikTok binding do not belong to the same customer.');
  }
  return job;
}

export async function publishToTikTok(jobId: string): Promise<void> {
  const initial = await validateJobBoundary(jobId);
  if (!initial || isTerminalJob(initial.status)) return;
  const leaseToken = await acquireLease(jobId);
  if (!leaseToken) return;

  try {
    let job = await validateJobBoundary(jobId);
    if (!job || isTerminalJob(job.status)) return;

    if (job.status === 'pending') {
      await prisma.$transaction(async (tx) => {
        await transitionJob(tx, jobId, 'pending', 'uploading', {
          deliveryStage: 'tiktok_initializing',
          errorCode: null,
          errorMessage: null,
          errorDetail: null,
          failedAt: null,
          retryable: false,
        });
        await tx.jobHistory.create({
          data: {
            jobId,
            status: 'tiktok_initializing',
            changedBy: 'tiktok_inbox_worker',
            notes: 'Official TikTok Inbox uploader started',
          },
        });
      });
      job = await validateJobBoundary(jobId);
      if (!job) return;
    }

    if (job.status === 'uploading') {
      if (!job.accountBinding.active || job.accountBinding.status !== 'active') {
        throw new PublisherError(
          'tiktok_connection_expired',
          'TikTok connection is inactive. Reconnect TikTok and retry.',
          true,
        );
      }
      if (!job.publishId && job.initializationAttemptedAt) {
        throw new PublisherError(
          'tiktok_init_outcome_unknown',
          'TikTok initialization outcome is unknown. Automatic re-initialization is blocked to prevent a duplicate draft.',
        );
      }
      const media = await readVideo(job.content.videoUrl);
      if (!job.publishId) await initializeUpload(jobId, media.buffer);
      await uploadVideo(jobId, media.buffer, media.mimeType);
      job = await validateJobBoundary(jobId);
      if (!job) return;
    }

    if (job.status === 'publishing') await fetchPublishStatus(jobId);
  } catch (unknownError) {
    const job = await prisma.publishJob.findUnique({
      where: { id: jobId },
      select: { contentId: true, status: true },
    });
    if (!job || isTerminalJob(job.status)) return;
    const originalMessage = unknownError instanceof Error ? unknownError.message : String(unknownError);
    const error = unknownError instanceof PublisherError
      ? unknownError
      : new PublisherError('tiktok_delivery_failed', `TikTok draft delivery failed: ${originalMessage}`);
    if (error.temporary) await deferJob(jobId, error);
    else await failJob(jobId, job.contentId, error);
  } finally {
    await releaseLease(jobId, leaseToken);
  }
}

export async function reconcileTikTokJobs(limit = 20): Promise<{
  selected: number;
  fulfilled: number;
  rejected: number;
}> {
  const now = new Date();
  const jobs = await prisma.publishJob.findMany({
    where: {
      platform: 'tiktok',
      status: { in: [...activeJobStatuses] },
      AND: [
        { OR: [{ workerLeaseUntil: null }, { workerLeaseUntil: { lt: now } }] },
        {
          OR: [
            { status: { in: ['pending', 'uploading'] } },
            { status: 'publishing', nextStatusCheckAt: null },
            { status: 'publishing', nextStatusCheckAt: { lte: now } },
          ],
        },
      ],
    },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
  });
  const results = await Promise.allSettled(jobs.map(({ id }) => publishToTikTok(id)));
  return {
    selected: jobs.length,
    fulfilled: results.filter((result) => result.status === 'fulfilled').length,
    rejected: results.filter((result) => result.status === 'rejected').length,
  };
}
