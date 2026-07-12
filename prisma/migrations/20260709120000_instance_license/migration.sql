-- License activation state on the singleton instance config.
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "licensePlan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "licenseStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "licenseKeyPrefix" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "licenseActivatedAt" TIMESTAMP(3);
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "licenseExpiresAt" TIMESTAMP(3);
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "licenseGraceUntil" TIMESTAMP(3);
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "licenseSignedToken" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "licenseSource" TEXT;
