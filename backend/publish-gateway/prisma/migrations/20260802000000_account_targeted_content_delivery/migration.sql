-- Every legacy Content row remains unassigned.  Routing is never inferred.
ALTER TABLE "Content" ADD COLUMN "targetAccountBindingId" TEXT REFERENCES "AccountBinding"("id") ON DELETE SET NULL;
CREATE INDEX "Content_targetAccountBindingId_idx" ON "Content"("targetAccountBindingId");
