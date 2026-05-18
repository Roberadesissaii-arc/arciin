import { PrismaClient } from "@prisma/client"
import type { FastifyInstance } from "fastify"

import { reclassifyApplicationAssets } from "@/services/classification/reclassify-application-assets"
import { ensureMediaTypeEnumValues } from "@/services/database/ensure-media-type-enum"

declare global {
  // API-only Prisma singleton (refreshed on dev reload so new schema fields work)
  var __arciinApiPrisma: PrismaClient | undefined
}

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export async function registerPrisma(fastify: FastifyInstance) {
  if (global.__arciinApiPrisma) {
    await global.__arciinApiPrisma.$disconnect().catch(() => undefined)
  }

  const prisma = createPrismaClient()
  global.__arciinApiPrisma = prisma

  try {
    await ensureMediaTypeEnumValues(prisma)
    const reclassified = await reclassifyApplicationAssets(prisma)
    if (reclassified > 0) {
      fastify.log.info({ count: reclassified }, "Reclassified installer assets to APPLICATION")
    }
  } catch (err) {
    fastify.log.warn({ err }, "MediaType enum bootstrap skipped (run prisma migrate deploy)")
  }

  fastify.decorate("prisma", prisma)

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect()
  })
}
