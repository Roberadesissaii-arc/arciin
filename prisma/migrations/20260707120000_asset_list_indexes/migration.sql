-- Composite indexes for the hot asset list queries (library/folder browse,
-- newest-first, soft-deleted excluded). Idempotent so it is safe to re-run.
CREATE INDEX IF NOT EXISTS "Asset_libraryId_deletedAt_createdAt_idx"
  ON "Asset" ("libraryId", "deletedAt", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Asset_folderId_deletedAt_createdAt_idx"
  ON "Asset" ("folderId", "deletedAt", "createdAt" DESC);
