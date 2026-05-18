import type { PrismaClient } from "@prisma/client"

/** Idempotent — safe when migrate deploy already ran. */
export async function ensureMediaTypeEnumValues(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "MediaType" ADD VALUE IF NOT EXISTS 'APPLICATION'`,
  )
}
