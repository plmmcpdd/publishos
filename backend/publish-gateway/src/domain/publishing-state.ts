import type { Prisma, ContentStatus, JobStatus } from '@prisma/client';
import { AppError } from '../middleware/errors';

export const contentTransitions: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ['pending_review', 'approved', 'rejected'], pending_review: ['approved', 'rejected'],
  rejected: ['pending_review', 'approved'], approved: ['delivered'], failed: ['delivered'],
  delivered: ['published', 'failed'], published: [],
};
export const jobTransitions: Record<JobStatus, readonly JobStatus[]> = {
  pending: ['dispatched', 'uploading', 'failed', 'cancelled'],
  dispatched: ['client_confirmed', 'uploading', 'published', 'failed', 'cancelled'],
  client_confirmed: ['uploading', 'publishing', 'published', 'failed', 'cancelled'],
  uploading: ['publishing', 'published', 'failed'], publishing: ['published', 'failed'],
  published: [], failed: [], cancelled: [],
};
export const activeJobStatuses: readonly JobStatus[] = ['pending', 'dispatched', 'client_confirmed', 'uploading', 'publishing'];
export const terminalJobStatuses: readonly JobStatus[] = ['published', 'failed', 'cancelled'];
export const canTransitionContent = (from: ContentStatus, to: ContentStatus) => contentTransitions[from].includes(to);
export const canTransitionJob = (from: JobStatus, to: JobStatus) => jobTransitions[from].includes(to);
export const isActiveJob = (status: JobStatus) => activeJobStatuses.includes(status);
export const isTerminalJob = (status: JobStatus) => terminalJobStatuses.includes(status);
export function invalidTransition(kind: 'content' | 'publish_job', from: string, to: string): AppError {
  return new AppError(409, 'invalid_state_transition', `Cannot transition ${kind} from ${from} to ${to}`);
}
export async function transitionContent(tx: Prisma.TransactionClient, id: string, from: ContentStatus | readonly ContentStatus[], to: ContentStatus, data: Prisma.ContentUpdateManyMutationInput = {}) {
  const allowed = Array.isArray(from) ? from : [from];
  if (!allowed.some((status) => canTransitionContent(status, to))) throw invalidTransition('content', allowed.join(','), to);
  const result = await tx.content.updateMany({ where: { id, status: { in: [...allowed] } }, data: { ...data, status: to } });
  if (result.count !== 1) {
    const current = await tx.content.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new AppError(404, 'not_found', 'Content not found');
    throw invalidTransition('content', current.status, to);
  }
}
export async function transitionJob(tx: Prisma.TransactionClient, id: string, from: JobStatus | readonly JobStatus[], to: JobStatus, data: Prisma.PublishJobUpdateManyMutationInput = {}) {
  const allowed = Array.isArray(from) ? from : [from];
  if (!allowed.some((status) => canTransitionJob(status, to))) throw invalidTransition('publish_job', allowed.join(','), to);
  const result = await tx.publishJob.updateMany({ where: { id, status: { in: [...allowed] } }, data: { ...data, status: to, ...(isTerminalJob(to) ? { activeKey: null } : {}) } });
  if (result.count !== 1) {
    const current = await tx.publishJob.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new AppError(404, 'not_found', 'Publish job not found');
    throw invalidTransition('publish_job', current.status, to);
  }
}
export async function createActiveJob(tx: Prisma.TransactionClient, input: { contentId: string; accountBindingId: string; platform: string; scheduleAt?: Date | null; publishOptions?: string | null; }) {
  const activeKey = `${input.contentId}:${input.platform}`;
  const existing = await tx.publishJob.findUnique({ where: { activeKey } });
  if (existing) return { job: existing, created: false };
  try {
    const job = await tx.publishJob.create({ data: {
      contentId: input.contentId,
      accountBindingId: input.accountBindingId,
      platform: input.platform,
      scheduleAt: input.scheduleAt,
      publishOptions: input.publishOptions,
      status: 'pending',
      activeKey,
    } });
    return { job, created: true };
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    const job = await tx.publishJob.findUnique({ where: { activeKey } });
    if (!job) throw error;
    return { job, created: false };
  }
}

export function isImmediatePublishSchedule(scheduleAt?: Date | null, now = new Date()): boolean {
  return !scheduleAt || scheduleAt.getTime() < now.getTime() + 5 * 60_000;
}

export async function createOrGetActivePublishJob(tx: Prisma.TransactionClient, input: {
  contentId: string;
  accountBindingId: string;
  platform: string;
  scheduleAt?: Date | null;
  publishOptions?: string | null;
  dispatchWhenImmediate: boolean;
  changedBy?: string;
  createdNotes?: string;
  auditOnCreate?: {
    action: string;
    actorId?: string;
    actorType: string;
    targetType: string;
    targetId: string;
    details?: string;
  };
}) {
  // This conditional write both revalidates delivery and takes the SQLite write lock
  // before activeKey is inspected. A stale caller can therefore never create a job
  // after another transaction has published the content and cleared its activeKey.
  const delivered = await tx.content.updateMany({
    where: { id: input.contentId, status: 'delivered' },
    data: { status: 'delivered' },
  });
  if (delivered.count !== 1) {
    const current = await tx.content.findUnique({ where: { id: input.contentId }, select: { status: true } });
    if (!current) throw new AppError(404, 'not_found', 'Content not found');
    throw invalidTransition('content', current.status, 'create_publish_job');
  }

  const result = await createActiveJob(tx, input);
  if (!result.created) return result;

  let job = result.job;
  if (input.dispatchWhenImmediate && isImmediatePublishSchedule(input.scheduleAt)) {
    await transitionJob(tx, job.id, 'pending', 'dispatched');
    job = await tx.publishJob.findUniqueOrThrow({ where: { id: job.id } });
  }

  await tx.jobHistory.create({
    data: {
      jobId: job.id,
      status: job.status,
      changedBy: input.changedBy,
      notes: input.createdNotes || (job.status === 'dispatched' ? 'Job dispatched for immediate device publishing' : 'Job created'),
    },
  });
  if (input.auditOnCreate) await tx.auditLog.create({ data: input.auditOnCreate });
  return { job, created: true };
}
