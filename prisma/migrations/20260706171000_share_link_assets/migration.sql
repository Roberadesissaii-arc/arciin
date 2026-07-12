-- AlterEnum
ALTER TYPE "ShareResourceType" ADD VALUE 'ASSETS';

-- CreateTable
CREATE TABLE "ShareLinkAsset" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLinkAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareLinkAsset_shareLinkId_idx" ON "ShareLinkAsset"("shareLinkId");

-- CreateIndex
CREATE INDEX "ShareLinkAsset_assetId_idx" ON "ShareLinkAsset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLinkAsset_shareLinkId_assetId_key" ON "ShareLinkAsset"("shareLinkId", "assetId");

-- AddForeignKey
ALTER TABLE "ShareLinkAsset" ADD CONSTRAINT "ShareLinkAsset_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLinkAsset" ADD CONSTRAINT "ShareLinkAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
