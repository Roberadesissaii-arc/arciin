import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  connectMediaConnector,
  disconnectMediaConnector,
  ensureConnectorFolders,
  getConnectorStatus,
  type MediaConnectorDef,
} from "@/services/integrations/library-media-connector"
import { recordActivity } from "@/services/activity/record-activity"
import { requireRole } from "@/services/security/auth"
import { serializeIntegration } from "@/services/serializers"

const patchSchema = z.object({
  enabled: z.boolean().optional(),
})

export function registerMediaConnectorRoutes(
  fastify: FastifyInstance,
  def: MediaConnectorDef,
  opts: {
    basePath: string
    notConfiguredCode: string
    displayName: string
  },
) {
  const { basePath, notConfiguredCode, displayName } = opts

  fastify.get(
    `${basePath}/status`,
    { preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]) },
    async (_request, reply) => {
      const status = await getConnectorStatus(fastify.prisma, def)
      if (!status) {
        reply.status(404).send({
          error: { code: notConfiguredCode, message: `${displayName} integration has not been prepared yet.` },
        })
        return
      }
      reply.send({ data: status })
    },
  )

  fastify.post(
    `${basePath}/setup-folders`,
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const existing = await def.findIntegration(fastify.prisma)
      if (!existing) {
        reply.status(404).send({
          error: { code: notConfiguredCode, message: `${displayName} integration has not been prepared yet.` },
        })
        return
      }

      const result = await ensureConnectorFolders(fastify.prisma, def)

      if (request.auth) {
        await recordActivity(fastify.prisma, {
          userId: request.auth.user.id,
          type: def.foldersActivityType,
          title: `${displayName} folders ready`,
          message:
            result.created > 0
              ? `Created ${result.created} ${def.folderName} folder(s) in Videos, Images, and Music.`
              : `${def.folderName} folders already exist in Videos, Images, and Music.`,
        })
      }

      reply.send({ data: { created: result.created, folders: result.folders } })
    },
  )

  fastify.patch(
    basePath,
    { preHandler: requireRole(["OWNER", "ADMIN"]) },
    async (request, reply) => {
      const parsed = patchSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: `Invalid ${displayName} configuration.`,
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const existing = await def.findIntegration(fastify.prisma)
      if (!existing) {
        reply.status(404).send({
          error: { code: notConfiguredCode, message: `${displayName} integration has not been prepared yet.` },
        })
        return
      }

      let updated = existing

      if (parsed.data.enabled === true) {
        updated = await connectMediaConnector(fastify.prisma, def, existing)
      } else if (parsed.data.enabled === false) {
        updated = await disconnectMediaConnector(fastify.prisma, def, existing)
      } else {
        updated = await fastify.prisma.integration.update({
          where: { id: existing.id },
          data: { enabled: existing.enabled },
        })
      }

      if (request.auth && parsed.data.enabled !== undefined) {
        await recordActivity(fastify.prisma, {
          userId: request.auth.user.id,
          type: parsed.data.enabled ? def.enabledActivityType : def.disabledActivityType,
          title: parsed.data.enabled ? `${displayName} layout enabled` : `${displayName} layout disabled`,
          message: parsed.data.enabled
            ? `Uploads to Videos, Images, and Music will use ${def.folderName} folders and mirror files on disk.`
            : `${def.folderName} folder routing and disk mirroring are turned off.`,
        })
      }

      reply.send({ data: serializeIntegration(updated) })
    },
  )
}
