import { PrismaClient } from "@prisma/client"
import type { FastifyInstance } from "fastify"

import {
  decryptModelProfileResult,
  encryptModelApiKey,
} from "@/services/security/model-profile-key-crypto"

import { reclassifyApplicationAssets } from "@/services/classification/reclassify-application-assets"
import { reclassifyCodeAssets } from "@/services/classification/reclassify-code-assets"
import { ensureMediaTypeEnumValues } from "@/services/database/ensure-media-type-enum"
import { removeLegacyApplicationsLibrary } from "@/services/libraries/remove-legacy-applications-library"

declare global {
  // API-only Prisma singleton (refreshed on dev reload so new schema fields work)
  var __arciinApiPrisma: PrismaClient | undefined
}

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })

  /**
   * ModelProfile.apiKey is encrypted at rest. Doing it here rather than at each
   * of the ~70 call sites means no caller can forget, and none of them had to
   * change: they still read and write a plain string.
   */
  return base.$extends({
    query: {
      modelProfile: {
        async $allOperations({ args, query, operation }) {
          const a = args as { data?: Record<string, unknown> | Record<string, unknown>[] }
          if (a?.data) {
            const rows = Array.isArray(a.data) ? a.data : [a.data]
            for (const row of rows) {
              if (typeof row.apiKey === "string") {
                row.apiKey = encryptModelApiKey(row.apiKey)
              } else if (row.apiKey && typeof row.apiKey === "object") {
                // { set: "..." } update syntax
                const wrapped = row.apiKey as { set?: unknown }
                if (typeof wrapped.set === "string") {
                  wrapped.set = encryptModelApiKey(wrapped.set)
                }
              }
            }
          }
          const result = await query(args)
          // Aggregates and counts have no apiKey to unwrap.
          if (operation.startsWith("count") || operation.startsWith("aggregate")) return result
          return decryptModelProfileResult(result)
        },
      },
    },
  }) as unknown as PrismaClient
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
    const removedAppsLibrary = await removeLegacyApplicationsLibrary(prisma)
    if (removedAppsLibrary) {
      fastify.log.info("Removed legacy Applications library (assets moved to Inbox)")
    }
  } catch (err) {
    fastify.log.warn({ err }, "MediaType enum bootstrap skipped (run prisma migrate deploy)")
  }

  fastify.decorate("prisma", prisma)

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect()
  })
}
