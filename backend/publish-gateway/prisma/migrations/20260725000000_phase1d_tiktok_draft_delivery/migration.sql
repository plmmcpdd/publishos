-- Phase 1D: persist the client confirmation and the official TikTok Inbox
-- delivery/reconciliation state. Nullable fields preserve existing rows.
ALTER TABLE "Content" ADD COLUMN "clientConfirmedAt" DATETIME;
ALTER TABLE "Content" ADD COLUMN "clientConfirmedBy" TEXT;

ALTER TABLE "PublishJob" ADD COLUMN "deliveryStage" TEXT NOT NULL DEFAULT 'send_requested';
ALTER TABLE "PublishJob" ADD COLUMN "sendRequestedAt" DATETIME;
ALTER TABLE "PublishJob" ADD COLUMN "finalCaption" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "aiDisclosureRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PublishJob" ADD COLUMN "aiDisclosureMethod" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "initializationAttemptedAt" DATETIME;
ALTER TABLE "PublishJob" ADD COLUMN "uploadUrl" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "uploadExpiresAt" DATETIME;
ALTER TABLE "PublishJob" ADD COLUMN "uploadedBytes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PublishJob" ADD COLUMN "uploadCompletedAt" DATETIME;
ALTER TABLE "PublishJob" ADD COLUMN "inboxDeliveredAt" DATETIME;
ALTER TABLE "PublishJob" ADD COLUMN "lastPlatformStatus" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "lastStatusCheckedAt" DATETIME;
ALTER TABLE "PublishJob" ADD COLUMN "nextStatusCheckAt" DATETIME;
ALTER TABLE "PublishJob" ADD COLUMN "statusCheckFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PublishJob" ADD COLUMN "lastStatusError" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "workerLeaseToken" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "workerLeaseUntil" DATETIME;

CREATE UNIQUE INDEX "PublishJob_publishId_key" ON "PublishJob"("publishId");
CREATE INDEX "PublishJob_status_nextStatusCheckAt_idx" ON "PublishJob"("status", "nextStatusCheckAt");
CREATE INDEX "PublishJob_deliveryStage_workerLeaseUntil_idx" ON "PublishJob"("deliveryStage", "workerLeaseUntil");
