-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "folderUnlocks" JSONB;
