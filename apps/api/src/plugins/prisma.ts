import { PrismaClient } from "@prisma/client"
import type { FastifyInstance } from "fastify"

import { reclassifyApplicationAssets } from "@/services/classification/reclassify-application-assets"
import { reclassifyCodeAssets } from "@/services/classification/reclassify-code-assets"
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
    const reclassifiedApps = await reclassifyApplicationAssets(prisma)
    if (reclassifiedApps > 0) {
      fastify.log.info({ count: reclassifiedApps }, "Reclassified installer assets to APPLICATION")
    }
    const reclassifiedCode = await reclassifyCodeAssets(prisma)
    if (reclassifiedCode > 0) {
      fastify.log.info({ count: reclassifiedCode }, "Reclassified source files to CODE")
    }
  } catch (err) {
    fastify.log.warn({ err }, "MediaType enum bootstrap skipped (run prisma migrate deploy)")
  }

  fastify.decorate("prisma", prisma)

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect()
  })
}
