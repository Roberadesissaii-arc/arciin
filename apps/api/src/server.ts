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
import { registerAuthRoutes } from "@/modules/auth/routes"
import { registerFolderRoutes } from "@/modules/folders/routes"
import { registerInstanceRoutes } from "@/modules/instance/routes"
import { registerIntegrationRoutes } from "@/modules/integrations/routes"
import { registerJobRoutes } from "@/modules/jobs/routes"
import { registerLogsRoutes } from "@/modules/logs/routes"
import { registerLibraryRoutes } from "@/modules/libraries/routes"
import { registerPasswordVaultRoutes } from "@/modules/password-vault/routes"
import { registerSettingsRoutes } from "@/modules/settings/routes"
import { registerUploadRoutes } from "@/modules/uploads/routes"
import { registerWebhookRoutes } from "@/modules/webhooks/routes"
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
import { ensureStorageDirectories } from "@/services/storage/local-storage"

export async function createServer() {
  await mkdir(apiConfig.storage.logsDir, { recursive: true })
  const logPath = path.join(apiConfig.storage.logsDir, "api.log")

  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      stream: pino.multistream([
        { level: "info", stream: process.stdout },
        {
          level: "info",
          stream: pino.destination({ dest: logPath, mkdir: true, sync: false }),
        },
      ]),
    },
  })

  await registerHelmet(fastify)
  await registerErrorHandler(fastify)
  await registerCors(fastify)
  await registerCookies(fastify)
  await registerMultipart(fastify)
  await registerPrisma(fastify)
  await registerRedis(fastify)
  await registerApiProtection(fastify)
  await registerSocket(fastify)
  await ensureStorageDirectories()

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
      await registerAuthRoutes(api)
      await registerLibraryRoutes(api)
      await registerFolderRoutes(api)
      await registerAssetRoutes(api)
      await registerUploadRoutes(api)
      await registerActivityRoutes(api)
      await registerJobRoutes(api)
      await registerLogsRoutes(api)
      await registerApiKeyRoutes(api)
      await registerSettingsRoutes(api)
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
