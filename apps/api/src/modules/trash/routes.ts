import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { buildRealtimeEvent } from "@/services/events/publish-event"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import {
  emptyTrash,
  listTrashedAssets,
  permanentlyDeleteTrashedAsset,
  restoreTrashedAsset,
  serializeTrashAsset,
} from "@/services/assets/trash"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"

const assetIdParamsSchema = z.object({ assetId: z.string().min(1) })

const writeTrashPreHandler = requireSessionRolesOrApiKeyScopes(
  ["OWNER", "ADMIN", "MEMBER"],
  ["assets:write"],
)

/**
 * Trash lives under /api/trash (not /api/assets/trash) so it never collides with
 * GET /api/assets/:assetId treating "trash" as an asset id.
 */
export async function registerTrashRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/trash",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read"],
      ),
    },
    async (_request, reply) => {
      const rows = await listTrashedAssets(fastify.prisma)
      reply.send({
        data: rows.map(serializeTrashAsset),
      })
    },
  )

  fastify.post(
    "/trash/empty",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN"],
        ["assets:write", "admin"],
      ),
    },
    async (request, reply) => {
      const removed = await emptyTrash(fastify.prisma)

      if (request.auth && removed > 0) {
        await recordAndBroadcastActivity(fastify, {
          userId: request.auth.user.id,
          type: "asset.trash_emptied",
          title: "Trash emptied",
          message: `${removed} item${removed === 1 ? "" : "s"} permanently deleted from Trash.`,
          entityType: "instance",
        })
      }

      reply.send({ data: { removed } })
    },
  )

  fastify.post(
    "/trash/:assetId/restore",
    { preHandler: writeTrashPreHandler },
    async (request, reply) => {
      const params = assetIdParamsSchema.parse(request.params)
      const restored = await restoreTrashedAsset(fastify.prisma, params.assetId)

      if (!restored) {
        reply.status(404).send({
          error: {
            code: "TRASH_ITEM_NOT_FOUND",
            message: "This file is not in Trash or was already permanently deleted.",
          },
        })
        return
      }

      if (request.auth) {
        await recordAndBroadcastActivity(fastify, {
          userId: request.auth.user.id,
          type: "asset.restored",
          title: "Restored from Trash",
          message: `${restored.originalFilename} was restored to ${restored.library.name}.`,
          entityType: "asset",
          entityId: restored.id,
        })
        await fastify.publishRealtimeEvent(
          buildRealtimeEvent("asset.updated", {
            userId: request.auth.user.id,
            libraryId: restored.libraryId,
            assetId: restored.id,
            message: `${restored.originalFilename} restored from Trash.`,
          }),
        )
      }

      reply.send({ data: serializeTrashAsset(restored) })
    },
  )

  fastify.delete(
    "/trash/:assetId",
    { preHandler: writeTrashPreHandler },
    async (request, reply) => {
      const params = assetIdParamsSchema.parse(request.params)
      const removed = await permanentlyDeleteTrashedAsset(fastify.prisma, params.assetId)

      if (!removed) {
        reply.status(404).send({
          error: {
            code: "TRASH_ITEM_NOT_FOUND",
            message: "This file is not in Trash or was already permanently deleted.",
          },
        })
        return
      }

      if (request.auth) {
        await recordAndBroadcastActivity(fastify, {
          userId: request.auth.user.id,
          type: "asset.purged",
          title: "Permanently deleted",
          message: `${removed.originalFilename} was permanently deleted from Trash.`,
          entityType: "asset",
          entityId: removed.id,
        })
        await fastify.publishRealtimeEvent(
          buildRealtimeEvent("asset.deleted", {
            userId: request.auth.user.id,
            libraryId: removed.libraryId,
            assetId: removed.id,
            message: `${removed.originalFilename} permanently deleted.`,
          }),
        )
      }

      reply.send({ data: { success: true as const } })
    },
  )
}
