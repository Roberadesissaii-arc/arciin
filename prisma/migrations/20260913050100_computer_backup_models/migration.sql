-- Computer backup / folder sync foundation.
-- Pairing protocol is unchanged. Backup is a separate authorization.

CREATE TYPE "DeviceBackupStatus" AS ENUM ('ENABLED', 'DISABLED');
CREATE TYPE "DeviceBackupHealth" AS ENUM ('UP_TO_DATE', 'SYNCING', 'PAUSED', 'OFFLINE', 'ERROR', 'DISABLED');
CREATE TYPE "SyncRootKind" AS ENUM ('DESKTOP', 'DOCUMENTS', 'PICTURES', 'VIDEOS', 'MUSIC', 'DOWNLOADS', 'CUSTOM');
CREATE TYPE "SyncRootStatus" AS ENUM ('PROTECTED', 'SYNCING', 'PAUSED', 'ERROR', 'DISABLED');
CREATE TYPE "SyncEntryType" AS ENUM ('FILE', 'FOLDER');
CREATE TYPE "SyncEntryState" AS ENUM ('ACTIVE', 'TOMBSTONED');

CREATE TABLE "DeviceBackupProfile" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "status" "DeviceBackupStatus" NOT NULL DEFAULT 'ENABLED',
    "health" "DeviceBackupHealth" NOT NULL DEFAULT 'OFFLINE',
    "lastSyncAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "folderCount" INTEGER NOT NULL DEFAULT 0,
    "byteCount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceBackupProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceBackupProfile_deviceId_userId_key" ON "DeviceBackupProfile"("deviceId", "userId");
CREATE INDEX "DeviceBackupProfile_userId_idx" ON "DeviceBackupProfile"("userId");
CREATE INDEX "DeviceBackupProfile_status_idx" ON "DeviceBackupProfile"("status");
CREATE INDEX "DeviceBackupProfile_folderId_idx" ON "DeviceBackupProfile"("folderId");

CREATE TABLE "DeviceBackupGrant" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceBackupGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceBackupGrant_credentialHash_key" ON "DeviceBackupGrant"("credentialHash");
CREATE INDEX "DeviceBackupGrant_deviceId_revokedAt_idx" ON "DeviceBackupGrant"("deviceId", "revokedAt");
CREATE INDEX "DeviceBackupGrant_profileId_idx" ON "DeviceBackupGrant"("profileId");
CREATE INDEX "DeviceBackupGrant_userId_idx" ON "DeviceBackupGrant"("userId");

CREATE TABLE "SyncRoot" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "SyncRootKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "sourcePathIdentifier" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "status" "SyncRootStatus" NOT NULL DEFAULT 'PROTECTED',
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "folderCount" INTEGER NOT NULL DEFAULT 0,
    "byteCount" BIGINT NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRoot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncRoot_profileId_sourcePathIdentifier_key" ON "SyncRoot"("profileId", "sourcePathIdentifier");
CREATE INDEX "SyncRoot_deviceId_idx" ON "SyncRoot"("deviceId");
CREATE INDEX "SyncRoot_userId_idx" ON "SyncRoot"("userId");
CREATE INDEX "SyncRoot_folderId_idx" ON "SyncRoot"("folderId");

CREATE TABLE "SyncEntry" (
    "id" TEXT NOT NULL,
    "syncRootId" TEXT NOT NULL,
    "clientEntryId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "entryType" "SyncEntryType" NOT NULL,
    "assetId" TEXT,
    "folderId" TEXT,
    "sizeBytes" BIGINT,
    "contentHash" TEXT,
    "modifiedAtClient" TIMESTAMP(3),
    "syncState" "SyncEntryState" NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncEntry_syncRootId_clientEntryId_key" ON "SyncEntry"("syncRootId", "clientEntryId");
CREATE INDEX "SyncEntry_syncRootId_relativePath_idx" ON "SyncEntry"("syncRootId", "relativePath");
CREATE INDEX "SyncEntry_assetId_idx" ON "SyncEntry"("assetId");
CREATE INDEX "SyncEntry_folderId_idx" ON "SyncEntry"("folderId");
CREATE INDEX "SyncEntry_syncState_idx" ON "SyncEntry"("syncState");

ALTER TABLE "DeviceBackupProfile"
  ADD CONSTRAINT "DeviceBackupProfile_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceBackupProfile"
  ADD CONSTRAINT "DeviceBackupProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceBackupProfile"
  ADD CONSTRAINT "DeviceBackupProfile_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceBackupGrant"
  ADD CONSTRAINT "DeviceBackupGrant_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "DeviceBackupProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceBackupGrant"
  ADD CONSTRAINT "DeviceBackupGrant_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceBackupGrant"
  ADD CONSTRAINT "DeviceBackupGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncRoot"
  ADD CONSTRAINT "SyncRoot_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "DeviceBackupProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncRoot"
  ADD CONSTRAINT "SyncRoot_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncRoot"
  ADD CONSTRAINT "SyncRoot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncRoot"
  ADD CONSTRAINT "SyncRoot_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SyncEntry"
  ADD CONSTRAINT "SyncEntry_syncRootId_fkey"
  FOREIGN KEY ("syncRootId") REFERENCES "SyncRoot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncEntry"
  ADD CONSTRAINT "SyncEntry_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SyncEntry"
  ADD CONSTRAINT "SyncEntry_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Library" ("id", "name", "slug", "kind", "icon", "storageLocationId", "createdAt", "updatedAt")
SELECT
  'cmlib_' || sl.id,
  'Computers',
  'computers',
  'COMPUTER',
  'computer',
  sl.id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "StorageLocation" sl
WHERE sl."isDefault" = true
  AND NOT EXISTS (SELECT 1 FROM "Library" WHERE "slug" = 'computers');
