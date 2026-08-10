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

  /**
   * The counterpart to /activity: the security events that feed deliberately
   * filters out. Without this they were recorded but had nowhere to be read —
   * sign-ins, failed attempts, password changes and IP policy hits were
   * invisible outside the raw log files.
   *
   * Admin-only: it exposes who signed in from where.
   */
  fastify.get(
    "/activity/security",
    { preHandler: requireSessionRolesOrApiKeyScopes(["OWNER", "ADMIN"], ["activity:read"]) },
    async (_request, reply) => {
      // Narrow in the query, not after it. Taking the last N rows and then
      // filtering returns almost nothing on a busy instance, where uploads
      // vastly outnumber sign-ins — the newest 400 events held exactly one.
      const rows = await fastify.prisma.activityEvent.findMany({
        where: {
          OR: [{ type: { startsWith: "auth." } }, { type: { startsWith: "security." } }],
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      })

      reply.send({
        data: rows
          .filter((row) => isSecurityActivityType(row.type))
          .slice(0, 60)
          .map(serializeActivity),
      })
    },
  )
}
