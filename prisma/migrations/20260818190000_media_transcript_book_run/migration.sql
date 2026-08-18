-- Create the transcript, translation and book-run tables.
--
-- These three models had no migration at all. They were created by `db push`
-- during development, so every existing instance has them and nothing ever
-- noticed — but a clean clone running `prisma migrate deploy` got a database
-- with 33 of the schema's 35 tables, and `/api/assets` then failed with
-- P2021 ("MediaTranscript does not exist") the moment it tried to attach AI
-- summaries. The whole file list was a 500 on a brand-new install, and
-- transcription, translation and book generation had nowhere to store results.
--
-- Written idempotently for the same reason the dubbing removal was: instances
-- that got these objects from `db push` must be able to apply this as a no-op,
-- rather than failing on "already exists" and stopping the deploy.

DO $$ BEGIN
  CREATE TYPE "MediaTranscriptStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'NO_AUDIO', 'NO_SPEECH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BookRunStatus" AS ENUM ('PLANNING', 'THINKING', 'WRITING', 'VALIDATING', 'SAVING', 'PAUSED', 'INTERRUPTED', 'FAILED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "MediaTranscript" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" "MediaTranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "model" TEXT,
    "language" TEXT,
    "fullText" TEXT,
    "segments" JSONB,
    "durationSeconds" DOUBLE PRECISION,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "jobId" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaTranscript_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MediaTranslation" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" "MediaTranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "model" TEXT,
    "fullText" TEXT,
    "segments" JSONB,
    "error" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaTranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BookRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "BookRunStatus" NOT NULL DEFAULT 'PLANNING',
    "totalChapters" INTEGER NOT NULL DEFAULT 0,
    "writtenChapters" INTEGER NOT NULL DEFAULT 0,
    "currentChapter" INTEGER NOT NULL DEFAULT 1,
    "currentChapterTitle" TEXT,
    "manuscript" TEXT,
    "error" TEXT,
    "executorSessionId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BookRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MediaTranscript_assetId_key" ON "MediaTranscript"("assetId");
CREATE INDEX IF NOT EXISTS "MediaTranscript_status_idx" ON "MediaTranscript"("status");
CREATE INDEX IF NOT EXISTS "MediaTranslation_transcriptId_idx" ON "MediaTranslation"("transcriptId");
CREATE UNIQUE INDEX IF NOT EXISTS "MediaTranslation_transcriptId_language_key" ON "MediaTranslation"("transcriptId", "language");
CREATE UNIQUE INDEX IF NOT EXISTS "BookRun_conversationId_key" ON "BookRun"("conversationId");
CREATE INDEX IF NOT EXISTS "BookRun_userId_status_idx" ON "BookRun"("userId", "status");
CREATE INDEX IF NOT EXISTS "BookRun_leaseExpiresAt_idx" ON "BookRun"("leaseExpiresAt");

-- Foreign keys, guarded: ADD CONSTRAINT has no IF NOT EXISTS.
DO $$ BEGIN
  ALTER TABLE "MediaTranscript" ADD CONSTRAINT "MediaTranscript_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MediaTranslation" ADD CONSTRAINT "MediaTranslation_transcriptId_fkey"
    FOREIGN KEY ("transcriptId") REFERENCES "MediaTranscript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BookRun" ADD CONSTRAINT "BookRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BookRun" ADD CONSTRAINT "BookRun_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
