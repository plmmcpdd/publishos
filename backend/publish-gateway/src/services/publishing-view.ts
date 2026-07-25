import type { ContentStatus, JobStatus } from '@prisma/client';

export type DeliveryState =
  | 'ready_to_review'
  | 'ready_to_send'
  | 'send_requested'
  | 'tiktok_initializing'
  | 'uploading_video'
  | 'tiktok_processing'
  | 'sent_to_tiktok'
  | 'waiting_for_final_tiktok_publish'
  | 'published'
  | 'failed'
  | 'cancelled';

type PublishJobView = {
  status: JobStatus;
  deliveryStage?: string | null;
  inboxDeliveredAt?: Date | null;
  retryable?: boolean;
};

export function deriveDeliveryState(
  content: { status: ContentStatus; clientConfirmedAt?: Date | null },
  job?: PublishJobView | null,
): DeliveryState {
  if (!job) return content.clientConfirmedAt ? 'ready_to_send' : 'ready_to_review';
  if (job.status === 'published' || content.status === 'published') return 'published';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'cancelled') return 'cancelled';
  if (job.inboxDeliveredAt || job.deliveryStage === 'waiting_for_final_tiktok_publish') {
    return 'waiting_for_final_tiktok_publish';
  }
  if (job.deliveryStage === 'sent_to_tiktok') return 'sent_to_tiktok';
  if (job.deliveryStage === 'tiktok_processing') return 'tiktok_processing';
  if (job.deliveryStage === 'uploading_video') return 'uploading_video';
  if (job.deliveryStage === 'tiktok_initializing') return 'tiktok_initializing';
  return 'send_requested';
}

export function deliveryMessage(state: DeliveryState): string {
  const messages: Record<DeliveryState, string> = {
    ready_to_review: 'Ready to review',
    ready_to_send: 'Ready to send',
    send_requested: 'Send to TikTok requested',
    tiktok_initializing: 'Initializing TikTok upload',
    uploading_video: 'Uploading video',
    tiktok_processing: 'TikTok is processing the video',
    sent_to_tiktok: 'Sent to TikTok',
    waiting_for_final_tiktok_publish: 'Open TikTok on your phone to finish publishing',
    published: 'TikTok confirmed the final publish',
    failed: 'TikTok delivery failed',
    cancelled: 'TikTok delivery cancelled',
  };
  return messages[state];
}
