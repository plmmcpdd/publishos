-- Every legacy Content row remains unassigned.  Routing is never inferred.
ALTER TABLE "Content" ADD COLUMN "targetAccountBindingId" TEXT;
CREATE INDEX "Content_targetAccountBindingId_idx" ON "Content"("targetAccountBindingId");
