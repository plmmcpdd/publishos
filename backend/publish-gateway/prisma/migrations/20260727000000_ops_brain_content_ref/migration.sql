-- Adds a stable, tenant-scoped external content reference without changing existing IDs or relations.
ALTER TABLE "Content" ADD COLUMN "contentRef" TEXT;
CREATE UNIQUE INDEX "Content_clientId_contentRef_key" ON "Content"("clientId", "contentRef");
