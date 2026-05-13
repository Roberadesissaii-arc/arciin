import { createReadStream } from "node:fs"
import { access } from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { recordActivity } from "@/services/activity/record-activity"
import { requireRole } from "@/services/security/auth"
import { serializeAsset } from "@/services/serializers"
import { getStoragePaths } from "@/services/storage/local-storage"

const assetUpdateSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
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
        })
        .parse(request.query)

      const assets = await fastify.prisma.asset.findMany({
        where: {
          deletedAt: null,
          libraryId: query.libraryId,
          folderId: query.folderId,
          mediaType: query.mediaType as never,
          OR: query.search
            ? [
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
              ]
            : undefined,
        },
        orderBy: {
          createdAt: "desc",
        },
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
      reply.header(
        "content-disposition",
        `attachment; filename="${asset.originalFilename}"`
      )

      return reply.send(createReadStream(asset.storageObject.physicalPath))
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
