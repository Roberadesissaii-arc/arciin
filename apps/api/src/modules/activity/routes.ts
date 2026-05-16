import type { FastifyInstance } from "fastify"

import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { serializeActivity } from "@/services/serializers"

export async function registerActivityRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/activity",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["activity:read"],
      ),
    },
    async (_request, reply) => {
      const activity = await fastify.prisma.activityEvent.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
      })

      reply.send({
        data: activity.map(serializeActivity),
      })
    }
  )
}
