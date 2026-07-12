-- CreateEnum
CREATE TYPE "ShareFeedbackSentiment" AS ENUM ('LIKE', 'DISLIKE');

-- CreateTable
CREATE TABLE "ShareFeedback" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "assetId" TEXT,
    "sentiment" "ShareFeedbackSentiment" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareFeedback_shareLinkId_idx" ON "ShareFeedback"("shareLinkId");

-- CreateIndex
CREATE INDEX "ShareFeedback_assetId_idx" ON "ShareFeedback"("assetId");

-- CreateIndex
CREATE INDEX "ShareFeedback_createdAt_idx" ON "ShareFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "ShareFeedback" ADD CONSTRAINT "ShareFeedback_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareFeedback" ADD CONSTRAINT "ShareFeedback_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
