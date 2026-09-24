-- AlterTable: additive and nullable. Existing keys stay NULL (grandfathered).
ALTER TABLE "ApiKey" ADD COLUMN "rateLimitPerMinute" INTEGER;
