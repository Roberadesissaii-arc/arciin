-- CreateEnum
CREATE TYPE "ShareResourceType" AS ENUM ('ASSET', 'FOLDER');

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "resourceType" "ShareResourceType" NOT NULL,
    "assetId" TEXT,
    "folderId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxViews" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "allowDownload" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ShareLink_createdById_idx" ON "ShareLink"("createdById");

-- CreateIndex
CREATE INDEX "ShareLink_assetId_idx" ON "ShareLink"("assetId");

-- CreateIndex
CREATE INDEX "ShareLink_folderId_idx" ON "ShareLink"("folderId");

-- CreateIndex
CREATE INDEX "ShareLink_revokedAt_idx" ON "ShareLink"("revokedAt");

-- CreateIndex
CREATE INDEX "ShareLink_expiresAt_idx" ON "ShareLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
