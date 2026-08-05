-- CreateEnum
CREATE TYPE "FileRequestStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'LIMIT_REACHED');

-- CreateEnum
CREATE TYPE "FileRequestSubmissionStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_FLIGHT', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "fileRequestId" TEXT,
ADD COLUMN     "fileRequestSubmissionId" TEXT;

-- CreateTable
CREATE TABLE "FileRequest" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "destinationLibraryId" TEXT NOT NULL,
    "destinationFolderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" "FileRequestStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "allowAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "requireName" BOOLEAN NOT NULL DEFAULT false,
    "requireEmail" BOOLEAN NOT NULL DEFAULT false,
    "allowSubmitterViewOwn" BOOLEAN NOT NULL DEFAULT false,
    "notifyOwner" BOOLEAN NOT NULL DEFAULT true,
    "accessCodeHash" TEXT,
    "allowedMediaTypes" TEXT[],
    "allowedExtensions" TEXT[],
    "maxFileSizeBytes" BIGINT,
    "maxTotalBytes" BIGINT,
    "maxFileCount" INTEGER,
    "currentBytes" BIGINT NOT NULL DEFAULT 0,
    "currentFileCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileRequestSubmission" (
    "id" TEXT NOT NULL,
    "fileRequestId" TEXT NOT NULL,
    "status" "FileRequestSubmissionStatus" NOT NULL DEFAULT 'UPLOADING',
    "submitterName" TEXT,
    "submitterEmail" TEXT,
    "abuseIdentifierHash" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "FileRequestSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadOutbox" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "UploadOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_FLIGHT',
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FileRequest_tokenHash_key" ON "FileRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "FileRequest_tokenHash_idx" ON "FileRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "FileRequest_createdByUserId_idx" ON "FileRequest"("createdByUserId");

-- CreateIndex
CREATE INDEX "FileRequest_status_expiresAt_idx" ON "FileRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "FileRequest_destinationFolderId_idx" ON "FileRequest"("destinationFolderId");

-- CreateIndex
CREATE INDEX "FileRequest_createdAt_idx" ON "FileRequest"("createdAt");

-- CreateIndex
CREATE INDEX "FileRequestSubmission_fileRequestId_createdAt_idx" ON "FileRequestSubmission"("fileRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "FileRequestSubmission_status_idx" ON "FileRequestSubmission"("status");

-- CreateIndex
CREATE INDEX "FileRequestSubmission_notifiedAt_idx" ON "FileRequestSubmission"("notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadOutbox_jobId_key" ON "UploadOutbox"("jobId");

-- CreateIndex
CREATE INDEX "UploadOutbox_status_availableAt_idx" ON "UploadOutbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "UploadOutbox_createdAt_idx" ON "UploadOutbox"("createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");

-- CreateIndex
CREATE INDEX "Asset_fileRequestId_idx" ON "Asset"("fileRequestId");

-- CreateIndex
CREATE INDEX "Asset_fileRequestSubmissionId_idx" ON "Asset"("fileRequestSubmissionId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_fileRequestId_fkey" FOREIGN KEY ("fileRequestId") REFERENCES "FileRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_fileRequestSubmissionId_fkey" FOREIGN KEY ("fileRequestSubmissionId") REFERENCES "FileRequestSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_destinationLibraryId_fkey" FOREIGN KEY ("destinationLibraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_destinationFolderId_fkey" FOREIGN KEY ("destinationFolderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequestSubmission" ADD CONSTRAINT "FileRequestSubmission_fileRequestId_fkey" FOREIGN KEY ("fileRequestId") REFERENCES "FileRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

