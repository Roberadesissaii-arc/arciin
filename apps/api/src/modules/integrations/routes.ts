import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireRole } from "@/services/security/auth"
import { serializeIntegration } from "@/services/serializers"

const plexSchema = z.object({
  enabled: z.boolean().optional(),
  serverUrl: z.string().optional(),
  token: z.string().optional(),
  libraryMapping: z.string().optional(),
  preferredFolder: z.string().optional(),
})

export async function registerIntegrationRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/integrations",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (_request, reply) => {
      const integrations = await fastify.prisma.integration.findMany({
        orderBy: {
          createdAt: "asc",
        },
      })

      reply.send({
        data: integrations.map(serializeIntegration),
      })
    }
  )

  fastify.get(
    "/integrations/plex",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (_request, reply) => {
      const plex = await fastify.prisma.integration.findFirst({
        where: {
          type: "PLEX",
        },
      })

      if (!plex) {
        reply.status(404).send({
          error: {
            code: "PLEX_NOT_CONFIGURED",
            message: "Plex integration has not been prepared yet.",
          },
        })
        return
      }

      reply.send({
        data: serializeIntegration(plex),
      })
    }
  )

  fastify.patch(
    "/integrations/plex",
    {
      preHandler: requireRole(["OWNER", "ADMIN"]),
    },
    async (request, reply) => {
      const parsed = plexSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid Plex configuration.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const existing = await fastify.prisma.integration.findFirst({
        where: {
          type: "PLEX",
        },
      })

      if (!existing) {
        reply.status(404).send({
          error: {
            code: "PLEX_NOT_CONFIGURED",
            message: "Plex integration has not been prepared yet.",
          },
        })
        return
      }

      const updated = await fastify.prisma.integration.update({
        where: {
          id: existing.id,
        },
        data: {
          enabled: parsed.data.enabled ?? existing.enabled,
          config: {
            ...(existing.config as Record<string, unknown>),
            ...parsed.data,
          },
        },
      })

      reply.send({
        data: serializeIntegration(updated),
      })
    }
  )
}
