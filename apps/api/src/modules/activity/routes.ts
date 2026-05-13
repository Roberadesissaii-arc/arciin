import type { FastifyInstance } from "fastify"

import { requireRole } from "@/services/security/auth"
import { serializeActivity } from "@/services/serializers"

export async function registerActivityRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/activity",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
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
