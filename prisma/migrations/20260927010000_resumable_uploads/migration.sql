-- Additive: a new enum and table for resumable File Request uploads.
CREATE TYPE "ResumableUploadStatus" AS ENUM ('UPLOADING', 'VERIFYING', 'COMPLETE', 'FAILED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "ResumableUpload" (
    "id" TEXT NOT NULL,
    "fileRequestId" TEXT NOT NULL,
    "submissionId" TEXT,
    "status" "ResumableUploadStatus" NOT NULL DEFAULT 'UPLOADING',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "lastModified" BIGINT,
    "chunkSize" INTEGER NOT NULL,
    "receivedBytes" BIGINT NOT NULL DEFAULT 0,
    "submitterName" TEXT,
    "submitterEmail" TEXT,
    "abuseIdentifierHash" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "assetId" TEXT,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumableUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResumableUpload_fileRequestId_status_idx" ON "ResumableUpload"("fileRequestId", "status");
CREATE INDEX "ResumableUpload_status_expiresAt_idx" ON "ResumableUpload"("status", "expiresAt");

ALTER TABLE "ResumableUpload" ADD CONSTRAINT "ResumableUpload_fileRequestId_fkey" FOREIGN KEY ("fileRequestId") REFERENCES "FileRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
