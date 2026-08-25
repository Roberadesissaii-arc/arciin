-- User archive: hide from main libraries without soft-deleting (Trash).
ALTER TABLE "Asset" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Asset_archivedAt_idx" ON "Asset"("archivedAt");
CREATE INDEX "Asset_archivedAt_deletedAt_createdAt_idx" ON "Asset"("archivedAt", "deletedAt", "createdAt" DESC);
