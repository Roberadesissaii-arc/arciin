import type { FastifyInstance } from "fastify"

import { ensureDefaultMediaIntegrations } from "@/services/integrations/ensure-default-integrations"
import { JELLYFIN_INTEGRATION_ID } from "@/services/integrations/jellyfin"
import {
  JELLYFIN_CONNECTOR_DEF,
  PLEX_CONNECTOR_DEF,
} from "@/services/integrations/library-media-connector"
import { registerMediaConnectorRoutes } from "@/modules/integrations/connector-routes"
import { requireSessionRole } from "@/services/security/auth"
import { serializeIntegration } from "@/services/serializers"

export async function registerIntegrationRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/integrations",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      await ensureDefaultMediaIntegrations(fastify.prisma)
      const integrations = await fastify.prisma.integration.findMany({
        orderBy: { createdAt: "asc" },
        take: 100,
      })
      reply.send({ data: integrations.map(serializeIntegration) })
    },
  )

  fastify.get(
    "/integrations/plex",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const plex = await fastify.prisma.integration.findFirst({ where: { type: "PLEX" } })
      if (!plex) {
        reply.status(404).send({
          error: { code: "PLEX_NOT_CONFIGURED", message: "Plex integration has not been prepared yet." },
        })
        return
      }
      reply.send({ data: serializeIntegration(plex) })
    },
  )

  fastify.get(
    "/integrations/jellyfin",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      const jellyfin = await fastify.prisma.integration.findFirst({
        where: { id: JELLYFIN_INTEGRATION_ID },
      })
      if (!jellyfin) {
        reply.status(404).send({
          error: {
            code: "JELLYFIN_NOT_CONFIGURED",
            message: "Jellyfin integration has not been prepared yet.",
          },
        })
        return
      }
      reply.send({ data: serializeIntegration(jellyfin) })
    },
  )

  registerMediaConnectorRoutes(fastify, PLEX_CONNECTOR_DEF, {
    basePath: "/integrations/plex",
    notConfiguredCode: "PLEX_NOT_CONFIGURED",
    displayName: "Plex",
  })

  registerMediaConnectorRoutes(fastify, JELLYFIN_CONNECTOR_DEF, {
    basePath: "/integrations/jellyfin",
    notConfiguredCode: "JELLYFIN_NOT_CONFIGURED",
    displayName: "Jellyfin",
  })
}
