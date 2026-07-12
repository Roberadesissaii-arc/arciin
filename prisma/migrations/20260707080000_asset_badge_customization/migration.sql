-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "badgeLabel" TEXT,
ADD COLUMN     "badgeColor" TEXT,
ADD COLUMN     "showBadge" BOOLEAN NOT NULL DEFAULT true;
