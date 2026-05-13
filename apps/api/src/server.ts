import Fastify from "fastify"

import { registerActivityRoutes } from "@/modules/activity/routes"
import { registerApiKeyRoutes } from "@/modules/api-keys/routes"
import { registerAssetRoutes } from "@/modules/assets/routes"
import { registerAuthRoutes } from "@/modules/auth/routes"
import { registerFolderRoutes } from "@/modules/folders/routes"
import { registerInstanceRoutes } from "@/modules/instance/routes"
import { registerIntegrationRoutes } from "@/modules/integrations/routes"
import { registerJobRoutes } from "@/modules/jobs/routes"
import { registerLibraryRoutes } from "@/modules/libraries/routes"
import { registerSettingsRoutes } from "@/modules/settings/routes"
import { registerUploadRoutes } from "@/modules/uploads/routes"
import { registerCookies } from "@/plugins/cookies"
import { registerCors } from "@/plugins/cors"
import { registerMultipart } from "@/plugins/multipart"
import { registerPrisma } from "@/plugins/prisma"
import { registerRedis } from "@/plugins/redis"
import { registerSocket } from "@/plugins/socket"
import { registerHealthRoutes } from "@/routes/health.routes"
import { ensureStorageDirectories } from "@/services/storage/local-storage"

export async function createServer() {
  const fastify = Fastify({
    logger: true,
  })

  await registerCors(fastify)
  await registerCookies(fastify)
  await registerMultipart(fastify)
  await registerPrisma(fastify)
  await registerRedis(fastify)
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
      await registerApiKeyRoutes(api)
      await registerSettingsRoutes(api)
      await registerIntegrationRoutes(api)
    },
    {
      prefix: "/api",
    }
  )

  return fastify
}
