import { mkdir } from "node:fs/promises"
import path from "node:path"

import Fastify from "fastify"
import pino from "pino"

import { apiConfig } from "@/config"
import { registerAdminRoutes } from "@/modules/admin/routes"
import { registerChatRoutes } from "@/modules/chat/routes"
import { registerModelRoutes } from "@/modules/models/routes"
import { registerActivityRoutes } from "@/modules/activity/routes"
import { registerApiKeyRoutes } from "@/modules/api-keys/routes"
import { registerAppDatabaseRoutes } from "@/modules/app-databases/routes"
import { registerAssetRoutes } from "@/modules/assets/routes"
import { registerDocumentRoutes } from "@/modules/documents/routes"
import { transcriptRoutes } from "@/modules/transcripts/routes"
import { bookRunRoutes } from "@/modules/book-runs/routes"
import { registerAuthRoutes } from "@/modules/auth/routes"
import { registerFolderRoutes } from "@/modules/folders/routes"
import { registerInstanceRoutes } from "@/modules/instance/routes"
import { registerIntegrationRoutes } from "@/modules/integrations/routes"
import { registerJobRoutes } from "@/modules/jobs/routes"
import { registerLogsRoutes } from "@/modules/logs/routes"
import { registerMobileRoutes } from "@/modules/mobile/routes"
import { registerLibraryRoutes } from "@/modules/libraries/routes"
import { registerPasswordVaultRoutes } from "@/modules/password-vault/routes"
import { registerSettingsRoutes } from "@/modules/settings/routes"
import { registerFileRequestRoutes } from "@/modules/file-requests/routes"
import { registerShareRoutes } from "@/modules/shares/routes"
import { registerUploadRoutes } from "@/modules/uploads/routes"
import { registerImportRoutes } from "@/modules/imports/routes"
import { registerTrashRoutes } from "@/modules/trash/routes"
import { registerWebhookRoutes } from "@/modules/webhooks/routes"
import { registerLicenseRoutes } from "@/modules/license/routes"
import { registerApiProtection } from "@/plugins/api-protection"
import { registerCookies } from "@/plugins/cookies"
import { registerCors } from "@/plugins/cors"
import { registerErrorHandler } from "@/plugins/error-handler"
import { registerHelmet } from "@/plugins/helmet"
import { registerMultipart } from "@/plugins/multipart"
import { registerPrisma } from "@/plugins/prisma"
import { registerRedis } from "@/plugins/redis"
import { registerSocket } from "@/plugins/socket"
import { registerHealthRoutes } from "@/routes/health.routes"
import { purgeExpiredTrash } from "@/services/assets/trash"
import { trimOversizedLogFiles } from "@/services/logs/log-files"
import { registerCloudflareTunnelPersistence } from "@/services/remote-access/tunnel-boot"
import { repairInstanceStorageRootsIfNeeded } from "@/services/storage/effective-storage-root"
import { initUploadLimits } from "@/services/config/upload-limits"
import { integrationsQueue, mediaQueue, storageQueue } from "@/services/jobs/queues"
import {
  pruneDispatchedOutbox,
  reconcileOutbox,
} from "@/services/uploads/outbox-dispatch"
import { pruneExpiredIdempotencyRecords } from "@/services/uploads/idempotency-store"
import { ensureStorageDirectories } from "@/services/storage/local-storage"

const REDACTED_QUERY_PARAMS = ["access_token", "media_token"]

/**
 * Media URLs carry their credential in the query string because media tags
 * cannot send headers. Neither belongs in a log file: `access_token` is a live
 * session, and `media_token` is a signed grant for one asset.
 */
function redactSensitiveUrl(url: string): string {
  const [pathPart, queryPart] = url.split("?")
  if (!queryPart) return url
  try {
    const params = new URLSearchParams(queryPart)
    let redacted = false
    for (const name of REDACTED_QUERY_PARAMS) {
      if (params.has(name)) {
        params.set(name, "[redacted]")
        redacted = true
      }
    }
    return redacted ? `${pathPart}?${params.toString()}` : url
  } catch {
    return url
  }
}

export async function createServer() {
  await mkdir(apiConfig.storage.logsDir, { recursive: true })
  const trimmedLogs = await trimOversizedLogFiles()
  const logPath = path.join(apiConfig.storage.logsDir, "api.log")

  const fastify = Fastify({
    // Trust only known proxy subnets (default: loopback + RFC-1918/ULA) so a
    // public client cannot forge X-Forwarded-For past the real edge proxy.
    trustProxy: apiConfig.trustProxy,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      stream: pino.multistream([
        { level: "info", stream: process.stdout },
        {
          level: "info",
          stream: pino.destination({ dest: logPath, mkdir: true, sync: false }),
        },
      ]),
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: redactSensitiveUrl(request.url),
            hostname: request.hostname,
            remoteAddress: request.ip,
            remotePort: request.socket?.remotePort,
          }
        },
      },
    },
  })

  await initUploadLimits()
  await registerHelmet(fastify)
  await registerErrorHandler(fastify)
  await registerCors(fastify)
  await registerCookies(fastify)
  await registerMultipart(fastify)
  await registerPrisma(fastify)
  await registerRedis(fastify)
  await registerApiProtection(fastify)
  await registerSocket(fastify)
  registerCloudflareTunnelPersistence(fastify)
  await ensureStorageDirectories()

  const storageRepair = await repairInstanceStorageRootsIfNeeded(fastify.prisma)
  if (storageRepair.repaired) {
    fastify.log.warn(
      { from: storageRepair.previousRoot, to: storageRepair.storageRoot },
      "Corrected instance storage root to match ARCIIN_DATA_DIR",
    )
    await ensureStorageDirectories(storageRepair.storageRoot)
  }

  if (trimmedLogs > 0) {
    fastify.log.info({ trimmedLogs }, "Trimmed oversized log files on startup")
  }

  const logTrimIntervalMs = 15 * 60_000
  const logTrimTimer = setInterval(() => {
    void trimOversizedLogFiles()
  }, logTrimIntervalMs)

  // iOS-style trash: permanently remove soft-deleted assets after 30 days.
  const trashPurgeIntervalMs = 6 * 60 * 60_000
  const runTrashPurge = () => {
    void purgeExpiredTrash(fastify.prisma)
      .then((removed) => {
        if (removed > 0) {
          fastify.log.info({ removed }, "Purged expired trash assets")
        }
      })
      .catch((error) => {
        fastify.log.warn({ err: error }, "Trash purge failed")
      })
  }
  // Defer first run slightly so startup isn't blocked by disk IO.
  const trashPurgeBootTimer = setTimeout(runTrashPurge, 45_000)
  const trashPurgeTimer = setInterval(runTrashPurge, trashPurgeIntervalMs)

  // Outbox reconciliation: the guarantee behind UP-007. An upload's background
  // jobs are committed as durable rows; if Redis was unreachable when the
  // request finished, this is what eventually gets them queued. Without it, a
  // brief Redis outage strands uploads permanently — which is exactly how 1,278
  // sessions were lost before.
  const outboxIntervalMs = 60_000
  const runOutboxReconcile = () => {
    void reconcileOutbox(fastify.prisma, {
      media: mediaQueue,
      storage: storageQueue,
      integrations: integrationsQueue,
    })
      .then((result) => {
        if (result.dispatched > 0 || result.deferred > 0) {
          fastify.log.info(result, "Reconciled upload outbox")
        }
      })
      .catch((error) => {
        fastify.log.warn({ err: error }, "Outbox reconciliation failed")
      })
  }
  const outboxBootTimer = setTimeout(runOutboxReconcile, 15_000)
  const outboxTimer = setInterval(runOutboxReconcile, outboxIntervalMs)

  const outboxPruneTimer = setInterval(
    () => {
      void pruneDispatchedOutbox(fastify.prisma).catch(() => {})
      void pruneExpiredIdempotencyRecords(fastify.prisma).catch(() => {})
    },
    6 * 60 * 60_000,
  )

  fastify.addHook("onClose", async () => {
    clearInterval(logTrimTimer)
    clearTimeout(trashPurgeBootTimer)
    clearInterval(trashPurgeTimer)
    clearTimeout(outboxBootTimer)
    clearInterval(outboxTimer)
    clearInterval(outboxPruneTimer)
  })

  fastify.get("/", async (_request, reply) => {
    reply.send({
      data: {
        name: "Arciin API",
      },
    })
  })

  await fastify.register(
    async (api) => {
      await registerHealthRoutes(api)
      await registerInstanceRoutes(api)
      await registerMobileRoutes(api)
      await registerAuthRoutes(api)
      await registerLibraryRoutes(api)
      await registerFolderRoutes(api)
      await registerAssetRoutes(api)
      await transcriptRoutes(api)
      await registerDocumentRoutes(api)
      await bookRunRoutes(api)
      await registerTrashRoutes(api)
      await registerShareRoutes(api)
      await registerFileRequestRoutes(api)
      await registerUploadRoutes(api)
      await registerImportRoutes(api)
      await registerActivityRoutes(api)
      await registerJobRoutes(api)
      await registerLogsRoutes(api)
      await registerApiKeyRoutes(api)
      await registerSettingsRoutes(api)
      await registerLicenseRoutes(api)
      await registerPasswordVaultRoutes(api)
      await registerWebhookRoutes(api)
      await registerIntegrationRoutes(api)
      await registerAppDatabaseRoutes(api)
      await registerAdminRoutes(api)
      await registerModelRoutes(api)
      await registerChatRoutes(api)
    },
    {
      prefix: "/api",
    }
  )

  return fastify
}
