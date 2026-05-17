-- InstanceConfig.aiConfig was added to the Prisma schema without a migration.
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "aiConfig" JSONB;
