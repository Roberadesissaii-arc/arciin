-- CreateEnum
CREATE TYPE "ChatMessageFeedbackRating" AS ENUM ('LIKE', 'DISLIKE');

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "feedbackRating" "ChatMessageFeedbackRating",
ADD COLUMN "feedbackAt" TIMESTAMP(3);
