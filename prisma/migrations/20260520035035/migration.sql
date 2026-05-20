-- CreateIndex
CREATE INDEX "ActivityEvent_userId_idx" ON "ActivityEvent"("userId");

-- CreateIndex
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");

-- CreateIndex
CREATE INDEX "Asset_storageObjectId_idx" ON "Asset"("storageObjectId");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "AssetTag_tagId_idx" ON "AssetTag"("tagId");

-- CreateIndex
CREATE INDEX "UploadSession_assetId_idx" ON "UploadSession"("assetId");
