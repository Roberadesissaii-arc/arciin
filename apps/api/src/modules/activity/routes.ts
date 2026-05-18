import { isSecurityActivityType } from "@arciin/shared"
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
      const rows = await fastify.prisma.activityEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 120,
      })

      const activity = rows
        .filter((row) => !isSecurityActivityType(row.type))
        .slice(0, 50)

      reply.send({
        data: activity.map(serializeActivity),
      })
    }
  )
}
