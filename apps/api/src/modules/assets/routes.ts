import { createReadStream } from "node:fs"
import { access } from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { buildRealtimeEvent } from "@/services/events/publish-event"
import { recordActivity } from "@/services/activity/record-activity"
import { requireRole } from "@/services/security/auth"
import { serializeAsset } from "@/services/serializers"
import { getStoragePaths } from "@/services/storage/local-storage"

const assetUpdateSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  originalFilename: z.string().min(1).max(255).optional(),
})

const assetMoveSchema = z.object({
  folderId: z.string().optional(),
  libraryId: z.string().optional(),
})

export async function registerAssetRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/assets",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
    },
    async (request, reply) => {
      const query = z
        .object({
          libraryId: z.string().optional(),
          folderId: z.string().optional(),
          mediaType: z.string().optional(),
          search: z.string().optional(),
          ids: z.string().optional(),
        })
        .parse(request.query)

      const idList = query.ids
        ? query.ids.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20)
        : undefined

      const assets = await fastify.prisma.asset.findMany({
        where: idList?.length
          ? {
              deletedAt: null,
              id: { in: idList },
            }
          : {
              deletedAt: null,
              ...(query.libraryId ? { libraryId: query.libraryId } : {}),
              ...(query.folderId !== undefined ? { folderId: query.folderId } : {}),
              ...(query.mediaType ? { mediaType: query.mediaType as never } : {}),
              ...(query.search
                ? {
                    OR: [
                      {
                        originalFilename: {
                          contains: query.search,
                          mode: "insensitive",
                        },
                      },
                      {
                        title: {
                          contains: query.search,
                          mode: "insensitive",
                        },
                      },
                    ],
                  }
                : {}),
            },
        orderBy: {
          createdAt: "desc",
        },
        take: 200,
      })

      reply.send({
        data: assets.map(serializeAsset),
      })
    }
  )

  fastify.get(
    "/assets/:assetId",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      const asset = await fastify.prisma.asset.findUnique({
        where: {
          id: params.assetId,
        },
      })

      if (!asset || asset.deletedAt) {
        reply.status(404).send({
          error: {
            code: "ASSET_NOT_FOUND",
            message: "Asset not found.",
          },
        })
        return
      }

      reply.send({
        data: serializeAsset(asset),
      })
    }
  )

  fastify.patch(
    "/assets/:assetId",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      const parsed = assetUpdateSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid asset payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const existing = await fastify.prisma.asset.findFirst({
        where: { id: params.assetId, deletedAt: null },
      })

      if (!existing) {
        reply.status(404).send({
          error: {
            code: "ASSET_NOT_FOUND",
            message: "Asset not found.",
          },
        })
        return
      }

      const asset = await fastify.prisma.asset.update({
        where: {
          id: params.assetId,
        },
        data: parsed.data,
      })

      reply.send({
        data: serializeAsset(asset),
      })
    }
  )

  fastify.delete(
    "/assets/:assetId",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)

      const toDelete = await fastify.prisma.asset.findFirst({
        where: { id: params.assetId, deletedAt: null },
      })

      if (!toDelete) {
        reply.status(404).send({
          error: { code: "ASSET_NOT_FOUND", message: "Asset not found." },
        })
        return
      }

      const asset = await fastify.prisma.asset.update({
        where: {
          id: params.assetId,
        },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
        },
      })

      if (request.auth) {
        await recordActivity(fastify.prisma, {
          userId: request.auth.user.id,
          type: "asset.deleted",
          title: "Asset deleted",
          message: `${asset.originalFilename} was moved to deleted state.`,
          entityType: "asset",
          entityId: asset.id,
        })
        await fastify.publishRealtimeEvent(
          buildRealtimeEvent("asset.deleted", {
            userId: request.auth.user.id,
            libraryId: asset.libraryId,
            assetId: asset.id,
            message: `${asset.originalFilename} deleted.`,
          })
        )
      }

      reply.send({
        data: {
          success: true,
        },
      })
    }
  )

  fastify.post(
    "/assets/:assetId/move",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      const parsed = assetMoveSchema.safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid move payload.",
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const current = await fastify.prisma.asset.findFirst({
        where: {
          id: params.assetId,
          deletedAt: null,
        },
      })

      if (!current) {
        reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Asset not found.",
          },
        })
        return
      }

      const { folderId: requestedFolderId, libraryId: requestedLibraryId } = parsed.data

      let nextFolderId: string | null
      let nextLibraryId: string

      if (requestedFolderId) {
        const targetFolder = await fastify.prisma.folder.findUnique({
          where: {
            id: requestedFolderId,
          },
        })

        if (!targetFolder) {
          reply.status(400).send({
            error: {
              code: "INVALID_FOLDER",
              message: "Folder not found.",
            },
          })
          return
        }

        nextFolderId = targetFolder.id
        nextLibraryId = targetFolder.libraryId
      } else {
        nextFolderId = null
        nextLibraryId = requestedLibraryId ?? current.libraryId
      }

      if (nextLibraryId !== current.libraryId) {
        const library = await fastify.prisma.library.findUnique({
          where: {
            id: nextLibraryId,
          },
        })

        if (!library) {
          reply.status(400).send({
            error: {
              code: "INVALID_LIBRARY",
              message: "Library not found.",
            },
          })
          return
        }
      }

      const asset = await fastify.prisma.asset.update({
        where: {
          id: params.assetId,
        },
        data: {
          folderId: nextFolderId,
          libraryId: nextLibraryId,
        },
      })

      if (request.auth) {
        await recordActivity(fastify.prisma, {
          userId: request.auth.user.id,
          type: "asset.moved",
          title: "Asset moved",
          message: `${asset.originalFilename} was moved.`,
          entityType: "asset",
          entityId: asset.id,
          metadata: {
            folderId: nextFolderId,
            libraryId: nextLibraryId,
          },
        })
        await fastify.publishRealtimeEvent(
          buildRealtimeEvent("asset.moved", {
            userId: request.auth.user.id,
            libraryId: nextLibraryId,
            assetId: asset.id,
            message: `${asset.originalFilename} moved.`,
            data: { folderId: nextFolderId, libraryId: nextLibraryId },
          })
        )
      }

      reply.send({
        data: serializeAsset(asset),
      })
    }
  )

  fastify.get(
    "/assets/:assetId/download",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      const query = z
        .object({
          /** Inline playback for `<audio>` / `<video>` previews (attachment breaks many browsers). */
          inline: z.string().optional(),
        })
        .parse(request.query ?? {})
      const inlinePreview =
        query.inline === "1" || query.inline === "true"

      const asset = await fastify.prisma.asset.findUnique({
        where: {
          id: params.assetId,
        },
        include: {
          storageObject: true,
        },
      })

      if (!asset || asset.deletedAt) {
        reply.status(404).send({
          error: {
            code: "ASSET_NOT_FOUND",
            message: "Asset not found.",
          },
        })
        return
      }

      reply.header("content-type", asset.mimeType)
      if (inlinePreview) {
        reply.header("content-disposition", "inline")
      } else {
        // Sanitize the filename to prevent header injection via quotes, newlines, etc.
        // Use RFC 5987 percent-encoding for the filename* parameter so arbitrary
        // Unicode characters (and ASCII control chars) are safe.
        const safeAscii = asset.originalFilename.replace(/[^\w.\- ]/g, "_")
        const encodedName = encodeURIComponent(asset.originalFilename)
        reply.header(
          "content-disposition",
          `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodedName}`
        )
      }

      // Prevent path traversal: verify the physical path is inside the storage root.
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const storageRoot = path.resolve(instance?.storageRoot ?? "")
      const resolvedPath = path.resolve(asset.storageObject.physicalPath)
      if (!resolvedPath.startsWith(storageRoot + path.sep) && resolvedPath !== storageRoot) {
        reply.status(403).send({
          error: {
            code: "FORBIDDEN",
            message: "Access to this file is not permitted.",
          },
        })
        return
      }

      return reply.send(createReadStream(resolvedPath))
    }
  )

  fastify.post(
    "/assets/check-duplicates",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]),
    },
    async (request, reply) => {
      const parsed = z
        .object({
          filenames: z.array(z.string().min(1).max(255)).min(1).max(50),
          libraryId: z.string().optional(),
          folderId: z.string().nullable().optional(),
        })
        .safeParse(request.body)

      if (!parsed.success) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Invalid payload." },
        })
        return
      }

      const { filenames, libraryId, folderId } = parsed.data

      const existing = await fastify.prisma.asset.findMany({
        where: {
          deletedAt: null,
          originalFilename: { in: filenames },
          ...(libraryId ? { libraryId } : {}),
          ...(folderId !== undefined ? { folderId: folderId ?? null } : {}),
        },
        select: { id: true, originalFilename: true },
      })

      reply.send({
        data: {
          duplicates: existing.map((a) => ({
            filename: a.originalFilename,
            assetId: a.id,
          })),
        },
      })
    }
  )

  fastify.get(
    "/assets/:assetId/thumbnail",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const thumbnailPath = path.join(
        getStoragePaths(instance?.storageRoot).thumbnailsDir,
        `${params.assetId}.webp`
      )

      try {
        await access(thumbnailPath)
      } catch {
        reply.status(404).send({
          error: {
            code: "THUMBNAIL_NOT_FOUND",
            message: "Thumbnail not found.",
          },
        })
        return
      }

      reply.header("content-type", "image/webp")
      return reply.send(createReadStream(thumbnailPath))
    }
  )
}
