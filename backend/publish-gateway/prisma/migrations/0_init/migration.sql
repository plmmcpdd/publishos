-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountUsername" TEXT NOT NULL,
    "platformUserId" TEXT,
    "username" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
    "scope" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "businessLocation" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountBinding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "caption" TEXT,
    "hashtags" TEXT NOT NULL DEFAULT '',
    "videoUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiTools" TEXT NOT NULL DEFAULT '',
    "platforms" TEXT NOT NULL,
    "scheduleAt" DATETIME,
    "publishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "complianceResults" TEXT,
    "licenseCheckPassed" BOOLEAN NOT NULL DEFAULT false,
    "licenseCheckedAt" DATETIME,
    "bannedWordsPassed" BOOLEAN NOT NULL DEFAULT false,
    "bannedWordsCheckedAt" DATETIME,
    "aiDisclosureConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "aiDisclosureConfirmedAt" DATETIME,
    CONSTRAINT "Content_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT,
    "licenseId" TEXT,
    "url" TEXT NOT NULL,
    "authorizationDocUrl" TEXT,
    "description" TEXT,
    CONSTRAINT "ContentAsset_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "accountBindingId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduleAt" DATETIME,
    "publishOptions" TEXT,
    "clientToken" TEXT,
    "jobToken" TEXT,
    "activeKey" TEXT,
    "taskTokenJti" TEXT,
    "taskTokenExpiresAt" DATETIME,
    "taskTokenConsumedAt" DATETIME,
    "taskDeviceId" TEXT,
    "platformPostId" TEXT,
    "platformPostUrl" TEXT,
    "publishId" TEXT,
    "publishedAt" DATETIME,
    "failedAt" DATETIME,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "errorMessage" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "deviceFingerprint" TEXT,
    "screenshotUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublishJob_accountBindingId_fkey" FOREIGN KEY ("accountBindingId") REFERENCES "AccountBinding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PerformanceMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "publishJobId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "engagementRate" REAL NOT NULL DEFAULT 0,
    "completionRate" REAL,
    "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricDate" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'daily',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceMetrics_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PerformanceMetrics_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PerformanceMetrics_publishJobId_fkey" FOREIGN KEY ("publishJobId") REFERENCES "PublishJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT,
    "notes" TEXT,
    CONSTRAINT "JobHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PublishJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "clientId" TEXT,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PublishLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "contentTitle" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "licenseCheckPassed" BOOLEAN NOT NULL,
    "bannedWordsPassed" BOOLEAN NOT NULL,
    "aiDisclosureConfirmed" BOOLEAN NOT NULL,
    "licenseCheckedAt" DATETIME,
    "bannedWordsCheckedAt" DATETIME,
    "aiDisclosureConfirmedAt" DATETIME,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "tiktokPostUrl" TEXT,
    "tiktokPostId" TEXT,
    "clientIp" TEXT,
    "userAgent" TEXT,
    "deviceId" TEXT,
    "sessionId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishLog_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "details" TEXT,
    "deviceId" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT NOT NULL,
    "phone" TEXT,
    "painPoints" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assignedTo" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TicketPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "type" TEXT NOT NULL DEFAULT 'other',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketPhoto_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiagnosisReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "somScore" REAL,
    "somChatgpt" REAL,
    "somGemini" REAL,
    "somPerplexity" REAL,
    "scoreGmb" REAL,
    "scoreWeb" REAL,
    "scoreContent" REAL,
    "scoreTrust" REAL,
    "scoreLocal" REAL,
    "aiSearchResults" JSONB,
    "coreFindings" JSONB,
    "competitors" JSONB,
    "recommendations" JSONB,
    "revenueImpact" JSONB,
    "summary" TEXT,
    "fullReport" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiagnosisReport_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_email_key" ON "Client"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AccountBinding_clientId_platform_accountUsername_key" ON "AccountBinding"("clientId", "platform", "accountUsername");

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_activeKey_key" ON "PublishJob"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_taskTokenJti_key" ON "PublishJob"("taskTokenJti");

-- CreateIndex
CREATE INDEX "PerformanceMetrics_clientId_collectedAt_idx" ON "PerformanceMetrics"("clientId", "collectedAt");

-- CreateIndex
CREATE INDEX "PerformanceMetrics_clientId_platform_idx" ON "PerformanceMetrics"("clientId", "platform");

-- CreateIndex
CREATE INDEX "PerformanceMetrics_contentId_idx" ON "PerformanceMetrics"("contentId");

-- CreateIndex
CREATE INDEX "PerformanceMetrics_publishJobId_idx" ON "PerformanceMetrics"("publishJobId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceMetrics_publishJobId_period_metricDate_key" ON "PerformanceMetrics"("publishJobId", "period", "metricDate");

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceId_key" ON "Device"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_token_key" ON "Device"("token");

-- CreateIndex
CREATE INDEX "PublishLog_contentId_idx" ON "PublishLog"("contentId");

-- CreateIndex
CREATE INDEX "PublishLog_userId_idx" ON "PublishLog"("userId");

-- CreateIndex
CREATE INDEX "PublishLog_timestamp_idx" ON "PublishLog"("timestamp");

-- CreateIndex
CREATE INDEX "PublishLog_status_idx" ON "PublishLog"("status");

-- CreateIndex
CREATE INDEX "TicketPhoto_ticketId_idx" ON "TicketPhoto"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosisReport_ticketId_key" ON "DiagnosisReport"("ticketId");

-- CreateIndex
CREATE INDEX "DiagnosisReport_ticketId_idx" ON "DiagnosisReport"("ticketId");
