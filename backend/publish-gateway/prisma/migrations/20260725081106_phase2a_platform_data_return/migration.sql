-- CreateTable
CREATE TABLE "PublishedPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publishJobId" TEXT NOT NULL,
    "accountBindingId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "platformPostUrl" TEXT,
    "publishedAt" DATETIME,
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishedPost_publishJobId_fkey" FOREIGN KEY ("publishJobId") REFERENCES "PublishJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishedPost_accountBindingId_fkey" FOREIGN KEY ("accountBindingId") REFERENCES "AccountBinding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccountBinding" (
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
    "grantedScopes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reauthorizationRequired" BOOLEAN NOT NULL DEFAULT false,
    "reauthorizationReason" TEXT,
    "lastCollectionAttemptAt" DATETIME,
    "lastCollectionSuccessAt" DATETIME,
    "nextCollectionAt" DATETIME,
    "collectionStatus" TEXT NOT NULL DEFAULT 'idle',
    "collectionErrorCode" TEXT,
    "collectionErrorMessage" TEXT,
    "businessLocation" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountBinding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AccountBinding" ("accessToken", "accountUsername", "active", "businessLocation", "clientId", "createdAt", "expiresAt", "id", "platform", "platformUserId", "refreshToken", "scope", "status", "updatedAt", "username") SELECT "accessToken", "accountUsername", "active", "businessLocation", "clientId", "createdAt", "expiresAt", "id", "platform", "platformUserId", "refreshToken", "scope", "status", "updatedAt", "username" FROM "AccountBinding";
DROP TABLE "AccountBinding";
ALTER TABLE "new_AccountBinding" RENAME TO "AccountBinding";
CREATE UNIQUE INDEX "AccountBinding_clientId_platform_accountUsername_key" ON "AccountBinding"("clientId", "platform", "accountUsername");
CREATE TABLE "new_PerformanceMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "publishJobId" TEXT NOT NULL,
    "publishedPostId" TEXT,
    "platform" TEXT NOT NULL,
    "platformPostId" TEXT NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "reach" INTEGER,
    "impressions" INTEGER,
    "engagementRate" REAL,
    "completionRate" REAL,
    "averageWatchTime" REAL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricDate" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'daily',
    "source" TEXT NOT NULL DEFAULT 'tiktok_api',
    "rawResponseHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceMetrics_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PerformanceMetrics_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PerformanceMetrics_publishJobId_fkey" FOREIGN KEY ("publishJobId") REFERENCES "PublishJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PerformanceMetrics_publishedPostId_fkey" FOREIGN KEY ("publishedPostId") REFERENCES "PublishedPost" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PerformanceMetrics" ("clientId", "collectedAt", "comments", "completionRate", "contentId", "createdAt", "engagementRate", "id", "impressions", "likes", "metricDate", "period", "platform", "platformPostId", "publishJobId", "reach", "saves", "shares", "views") SELECT "clientId", "collectedAt", "comments", "completionRate", "contentId", "createdAt", "engagementRate", "id", "impressions", "likes", "metricDate", "period", "platform", "platformPostId", "publishJobId", "reach", "saves", "shares", "views" FROM "PerformanceMetrics";
DROP TABLE "PerformanceMetrics";
ALTER TABLE "new_PerformanceMetrics" RENAME TO "PerformanceMetrics";
CREATE INDEX "PerformanceMetrics_clientId_collectedAt_idx" ON "PerformanceMetrics"("clientId", "collectedAt");
CREATE INDEX "PerformanceMetrics_clientId_platform_idx" ON "PerformanceMetrics"("clientId", "platform");
CREATE INDEX "PerformanceMetrics_contentId_idx" ON "PerformanceMetrics"("contentId");
CREATE INDEX "PerformanceMetrics_publishJobId_idx" ON "PerformanceMetrics"("publishJobId");
CREATE INDEX "PerformanceMetrics_publishedPostId_idx" ON "PerformanceMetrics"("publishedPostId");
CREATE UNIQUE INDEX "PerformanceMetrics_publishedPostId_period_metricDate_key" ON "PerformanceMetrics"("publishedPostId", "period", "metricDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PublishedPost_publishJobId_idx" ON "PublishedPost"("publishJobId");

-- CreateIndex
CREATE INDEX "PublishedPost_accountBindingId_idx" ON "PublishedPost"("accountBindingId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedPost_platform_platformPostId_key" ON "PublishedPost"("platform", "platformPostId");
