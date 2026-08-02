-- AddTable
CREATE TABLE "MobileCaptionHandoff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "targetAccountSnapshot" TEXT,
    "captionSnapshot" TEXT,
    "hashtagsSnapshot" TEXT NOT NULL,
    "captionTextSnapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "MobileCaptionHandoff_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MobileCaptionHandoff_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AddIndex
CREATE UNIQUE INDEX "MobileCaptionHandoff_tokenHash_key" ON "MobileCaptionHandoff"("tokenHash");

-- AddIndex
CREATE INDEX "MobileCaptionHandoff_clientId_contentId_expiresAt_idx" ON "MobileCaptionHandoff"("clientId", "contentId", "expiresAt");

-- AddIndex
CREATE INDEX "MobileCaptionHandoff_expiresAt_idx" ON "MobileCaptionHandoff"("expiresAt");
