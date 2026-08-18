-- Persist Assist → Summarize results with the transcript so they survive reload.
ALTER TABLE "MediaTranscript" ADD COLUMN IF NOT EXISTS "aiInsight" JSONB;
