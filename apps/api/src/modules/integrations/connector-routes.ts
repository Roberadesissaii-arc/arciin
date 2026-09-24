import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  connectMediaConnector,
  disconnectMediaConnector,
  ensureConnectorFolders,
  getConnectorStatus,
  type MediaConnectorDef,
} from "@/services/integrations/library-media-connector"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { requireSessionRole } from "@/services/security/auth"
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]) },
    async (request, reply) => {
      const status = await getConnectorStatus(fastify.prisma, def)
      if (!status) {
        reply.status(404).send({
          error: { code: notConfiguredCode, message: `${displayName} integration has not been prepared yet.` },
        })
        return
      }
      // Admins need the host path to point their media server at it. Nobody
      // else needs to learn where this server keeps its files.
      const role = request.auth?.user.role
      const canSeePaths = role === "OWNER" || role === "ADMIN"
      reply.send({
        data: canSeePaths ? status : { ...status, storageRoot: undefined, mirrorRootHint: undefined },
      })
    },
  )

  fastify.post(
    `${basePath}/setup-folders`,
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
        await recordAndBroadcastActivity(fastify, {
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
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
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
        await recordAndBroadcastActivity(fastify, {
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
