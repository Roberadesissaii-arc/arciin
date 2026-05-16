import { createReadStream } from "node:fs"
import { access, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { resolveArciinStorageRoot } from "@arciin/shared"

import { apiConfig } from "@/config"
import { buildRealtimeEvent } from "@/services/events/publish-event"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import {
  ensureThumbnailWritten,
  renderImageWebpThumbnailBuffer,
  renderVideoPlaceholderWebpBuffer,
  renderImagePlaceholderWebpBuffer,
  resolveReadableObjectPath,
  resolvedThumbnailPath,
} from "@/services/media/thumbnail-cache"
import {
  assetIsInJellyfinFolder,
  clearAssetJellyfinMirror,
  syncAssetToJellyfinMirror,
} from "@/services/integrations/jellyfin"
import {
  assetIsInPlexFolder,
  clearAssetMirrorIfLeavingConnectorFolders,
  clearAssetPlexMirror,
  syncAssetToPlexMirror,
} from "@/services/integrations/plex"
import { PLEX_CONNECTOR_DEF, JELLYFIN_CONNECTOR_DEF } from "@/services/integrations/library-media-connector"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { serializeAsset } from "@/services/serializers"

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
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read"],
      ),
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
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read"],
      ),
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
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["assets:write"],
      ),
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
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["assets:write"],
      ),
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

      await clearAssetPlexMirror(fastify.prisma, params.assetId).catch(() => {})
      await clearAssetJellyfinMirror(fastify.prisma, params.assetId).catch(() => {})

      const asset = await fastify.prisma.asset.update({
        where: {
          id: params.assetId,
        },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          libraryMirrorPath: null,
        },
      })

      if (request.auth) {
        await recordAndBroadcastActivity(fastify, {
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
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["assets:write"],
      ),
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

      const targetFolder = nextFolderId
        ? await fastify.prisma.folder.findUnique({ where: { id: nextFolderId } })
        : null

      if (assetIsInPlexFolder(targetFolder)) {
        await syncAssetToPlexMirror(fastify.prisma, asset.id).catch(() => {})
      } else if (assetIsInJellyfinFolder(targetFolder)) {
        await syncAssetToJellyfinMirror(fastify.prisma, asset.id).catch(() => {})
      } else {
        await clearAssetMirrorIfLeavingConnectorFolders(
          fastify.prisma,
          asset.id,
          targetFolder,
          PLEX_CONNECTOR_DEF,
          JELLYFIN_CONNECTOR_DEF,
        ).catch(() => {})
      }

      if (request.auth) {
        await recordAndBroadcastActivity(fastify, {
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
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read"],
      ),
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
          library: { select: { storageLocation: { select: { rootPath: true } } } },
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

      // Prevent path traversal: object must live under resolved storage root.
      const instance = await fastify.prisma.instanceConfig.findFirst()
      const resolvedSrc =
        (await resolveReadableObjectPath({
          configuredStorageRoot: instance?.storageRoot,
          physicalPath: asset.storageObject.physicalPath,
          objectKey: asset.storageObject.objectKey,
          extraRoots: [apiConfig.dataDir, asset.library?.storageLocation?.rootPath],
        })) ?? null

      if (!resolvedSrc) {
        reply.status(404).send({
          error: {
            code: "STORAGE_FILE_NOT_FOUND",
            message: "Original file is missing on the server.",
          },
        })
        return
      }

      const storageRoot = resolveArciinStorageRoot(instance?.storageRoot, resolvedSrc)
      const resolvedRoot = path.resolve(storageRoot)
      const resolvedPath = path.resolve(resolvedSrc)
      if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
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
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["assets:write"],
      ),
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
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      const asset = await fastify.prisma.asset.findFirst({
        where: { id: params.assetId, deletedAt: null },
        include: {
          storageObject: true,
          library: { select: { storageLocation: { select: { rootPath: true } } } },
        },
      })

      if (!asset?.storageObject) {
        reply.status(404).send({
          error: {
            code: "ASSET_NOT_FOUND",
            message: "Asset not found.",
          },
        })
        return
      }

      const instance = await fastify.prisma.instanceConfig.findFirst()

      const sourcePathResolved = await resolveReadableObjectPath({
        configuredStorageRoot: instance?.storageRoot,
        physicalPath: asset.storageObject.physicalPath,
        objectKey: asset.storageObject.objectKey,
        extraRoots: [apiConfig.dataDir, asset.library?.storageLocation?.rootPath],
      })

      if (!sourcePathResolved) {
        if (asset.mediaType === "IMAGE") {
          const placeholder = await renderImagePlaceholderWebpBuffer()
          reply.header("content-type", "image/webp")
          reply.header("Cache-Control", "no-store")
          return reply.send(placeholder)
        }
        if (asset.mediaType === "VIDEO") {
          const placeholder = await renderVideoPlaceholderWebpBuffer()
          reply.header("content-type", "image/webp")
          reply.header("Cache-Control", "no-store")
          return reply.send(placeholder)
        }
        reply.status(404).send({
          error: {
            code: "STORAGE_FILE_NOT_FOUND",
            message: "Original file is missing on the server (check storage root and data directory).",
          },
        })
        return
      }

      const thumbnailPath = resolvedThumbnailPath(
        instance?.storageRoot,
        asset.id,
        sourcePathResolved,
      )

      let hadFile = false
      try {
        await access(thumbnailPath)
        hadFile = true
      } catch {
        /* generate below */
      }

      if (!hadFile && (asset.mediaType === "VIDEO" || asset.mediaType === "IMAGE")) {
        await ensureThumbnailWritten({
          assetId: asset.id,
          mediaType: asset.mediaType,
          sourcePath: sourcePathResolved,
          thumbnailPath,
        })
      }

      try {
        await access(thumbnailPath)
        reply.header("content-type", "image/webp")
        reply.header("Cache-Control", "private, max-age=86400")
        return reply.send(createReadStream(thumbnailPath))
      } catch {
        /* try in-memory fallbacks */
      }

      if (asset.mediaType === "IMAGE") {
        const inline =
          (await renderImageWebpThumbnailBuffer(sourcePathResolved)) ??
          (await renderImagePlaceholderWebpBuffer())
        reply.header("content-type", "image/webp")
        reply.header("Cache-Control", "private, max-age=3600")
        void mkdir(path.dirname(thumbnailPath), { recursive: true }).then(() =>
          writeFile(thumbnailPath, inline).catch(() => {}),
        )
        return reply.send(inline)
      }

      if (asset.mediaType === "VIDEO") {
        const inline = await renderVideoPlaceholderWebpBuffer()
        reply.header("content-type", "image/webp")
        reply.header("Cache-Control", "private, max-age=3600")
        void mkdir(path.dirname(thumbnailPath), { recursive: true }).then(() =>
          writeFile(thumbnailPath, inline).catch(() => {}),
        )
        return reply.send(inline)
      }

      reply.status(404).send({
        error: {
          code: "THUMBNAIL_NOT_FOUND",
          message: "Thumbnail not found.",
        },
      })
    }
  )
}
