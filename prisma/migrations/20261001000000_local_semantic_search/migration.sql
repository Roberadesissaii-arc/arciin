-- Additive: local semantic search. A new enum and two new tables; no existing
-- column or row is changed. No database extension is required (vectors are
-- float32 BYTEA; see docs in packages/shared/src/semantic-search.ts).

-- CreateEnum
CREATE TYPE "SemanticIndexStatus" AS ENUM ('PENDING', 'INDEXED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "AssetSemanticIndex" (
    "assetId" TEXT NOT NULL,
    "status" "SemanticIndexStatus" NOT NULL DEFAULT 'PENDING',
    "semanticText" TEXT,
    "caption" TEXT,
    "captionModel" TEXT,
    "captionSourceChecksum" TEXT,
    "embedding" BYTEA,
    "embeddingModel" TEXT,
    "embeddingDigest" TEXT,
    "dimension" INTEGER,
    "indexVersion" INTEGER NOT NULL DEFAULT 0,
    "fingerprint" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetSemanticIndex_pkey" PRIMARY KEY ("assetId")
);

-- CreateTable
CREATE TABLE "SemanticSearchConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "indexingActive" BOOLEAN NOT NULL DEFAULT false,
    "embeddingModel" TEXT NOT NULL DEFAULT 'nomic-embed-text',
    "captionModel" TEXT,
    "rebuildEpoch" INTEGER NOT NULL DEFAULT 0,
    "indexingStartedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SemanticSearchConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetSemanticIndex_status_idx" ON "AssetSemanticIndex"("status");

-- CreateIndex
CREATE INDEX "AssetSemanticIndex_embeddingModel_embeddingDigest_indexVers_idx" ON "AssetSemanticIndex"("embeddingModel", "embeddingDigest", "indexVersion");

-- AddForeignKey
ALTER TABLE "AssetSemanticIndex" ADD CONSTRAINT "AssetSemanticIndex_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
