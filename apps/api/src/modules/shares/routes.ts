import { createReadStream } from "node:fs"
import { access } from "node:fs/promises"

import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { resolveInlineContentType } from "@arciin/shared"

import { apiConfig } from "@/config"
import {
  ensureThumbnailWritten,
  renderImagePlaceholderWebpBuffer,
  renderVideoPlaceholderWebpBuffer,
  resolveReadableObjectPath,
  resolvedThumbnailPath,
} from "@/services/media/thumbnail-cache"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { assertAssetFolderAccess } from "@/services/folders/folder-lock"
import { streamFileResponse } from "@/services/media/stream-file-response"
import { requireRole } from "@/services/security/auth"
import {
  ASSET_PAGE_ORDER_BY,
  buildAssetPage,
  buildCursorWhere,
  clampPageSize,
  decodeAssetCursor,
} from "@/services/libraries/asset-pagination"
import { serializeShareLink } from "@/services/serializers"
import {
  assertAssetInShareScope,
  assertFolderInShareScope,
  generateShareToken,
  recordShareView,
  recordShareFeedback,
  resolveShareByToken,
  serializePublicAsset,
  serializePublicFolder,
  shareResourceLabel,
} from "@/services/shares/share-access"

const createShareSchema = z
  .object({
    resourceType: z.enum(["ASSET", "ASSETS", "FOLDER"]),
    assetId: z.string().optional(),
    assetIds: z.array(z.string()).min(1).max(500).optional(),
    folderId: z.string().optional(),
    label: z.string().max(200).optional(),
    expiresInDays: z.number().int().min(1).max(365).optional(),
    maxViews: z.number().int().min(1).max(1_000_000).optional(),
    allowDownload: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.resourceType === "ASSET" && !value.assetId) {
      ctx.addIssue({ code: "custom", message: "assetId is required for asset shares." })
    }
    if (value.resourceType === "ASSETS" && (!value.assetIds || value.assetIds.length < 2)) {
      ctx.addIssue({
        code: "custom",
        message: "assetIds must include at least two files for a collection share.",
      })
    }
    if (value.resourceType === "FOLDER" && !value.folderId) {
      ctx.addIssue({ code: "custom", message: "folderId is required for folder shares." })
    }
  })

function shareAccessError(code: string, message: string) {
  return { error: { code, message } }
}

export async function registerShareRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/shares",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]),
    },
    async (request, reply) => {
      if (!request.auth) {
        reply.status(401).send(shareAccessError("UNAUTHORIZED", "Authentication required."))
        return
      }

      const shares = await fastify.prisma.shareLink.findMany({
        where: {
          createdById: request.auth.user.id,
          revokedAt: null,
        },
        include: {
          asset: { select: { originalFilename: true, title: true } },
          folder: { select: { name: true } },
          _count: { select: { shareAssets: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      })

      reply.send({
        data: shares.map(serializeShareLink),
      })
    },
  )

  fastify.post(
    "/shares",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]),
    },
    async (request, reply) => {
      const parsed = createShareSchema.safeParse(request.body)
      if (!parsed.success || !request.auth) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid share payload.",
            details: parsed.success ? undefined : parsed.error.flatten(),
          },
        })
        return
      }

      const { resourceType, assetId, assetIds, folderId, label, expiresInDays, maxViews, allowDownload } =
        parsed.data

      if (resourceType === "ASSET") {
        const asset = await fastify.prisma.asset.findUnique({
          where: { id: assetId },
        })
        if (!asset || asset.deletedAt) {
          reply.status(404).send(shareAccessError("ASSET_NOT_FOUND", "Asset not found."))
          return
        }
        if (!(await assertAssetFolderAccess(fastify, request, reply, asset.folderId))) {
          return
        }
      } else if (resourceType === "ASSETS") {
        const uniqueIds = [...new Set(assetIds ?? [])]
        const assets = await fastify.prisma.asset.findMany({
          where: {
            id: { in: uniqueIds },
            deletedAt: null,
            status: { not: "DELETED" },
          },
        })
        if (assets.length !== uniqueIds.length) {
          reply.status(404).send(shareAccessError("ASSET_NOT_FOUND", "One or more files were not found."))
          return
        }
        for (const asset of assets) {
          if (!(await assertAssetFolderAccess(fastify, request, reply, asset.folderId))) {
            return
          }
        }
      } else {
        const folder = await fastify.prisma.folder.findUnique({
          where: { id: folderId },
        })
        if (!folder || folder.deletedAt) {
          reply.status(404).send(shareAccessError("FOLDER_NOT_FOUND", "Folder not found."))
          return
        }
        if (folder.lockedAt) {
          reply.status(403).send(
            shareAccessError(
              "FOLDER_LOCKED",
              "Locked folders cannot be shared. Remove the lock first.",
            ),
          )
          return
        }
      }

      const { rawToken, tokenHash, tokenPrefix } = generateShareToken()
      const expiresAt =
        expiresInDays != null
          ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
          : null

      const uniqueAssetIds = resourceType === "ASSETS" ? [...new Set(assetIds ?? [])] : []

      const share = await fastify.prisma.shareLink.create({
        data: {
          createdById: request.auth.user.id,
          resourceType,
          assetId: resourceType === "ASSET" ? assetId : null,
          folderId: resourceType === "FOLDER" ? folderId : null,
          tokenHash,
          tokenPrefix,
          label: label?.trim() || null,
          expiresAt,
          maxViews: maxViews ?? null,
          allowDownload: allowDownload ?? true,
          ...(resourceType === "ASSETS"
            ? {
                shareAssets: {
                  create: uniqueAssetIds.map((id, index) => ({
                    assetId: id,
                    sortOrder: index,
                  })),
                },
              }
            : {}),
        },
        include: {
          asset: { select: { originalFilename: true, title: true } },
          folder: { select: { name: true } },
          _count: { select: { shareAssets: true } },
        },
      })

      const activityMessage =
        resourceType === "ASSET"
          ? "Shared a file."
          : resourceType === "ASSETS"
            ? `Shared ${uniqueAssetIds.length} files in one link.`
            : "Shared a folder."

      await recordAndBroadcastActivity(fastify, {
        userId: request.auth.user.id,
        type: "share.created",
        title: "Share link created",
        message: activityMessage,
        entityType: "share",
        entityId: share.id,
      })

      reply.status(201).send({
        data: {
          ...serializeShareLink(share),
          rawToken,
          shareUrlPath: `/s/${rawToken}`,
        },
      })
    },
  )

  fastify.delete(
    "/shares/:shareId",
    {
      preHandler: requireRole(["OWNER", "ADMIN", "MEMBER"]),
    },
    async (request, reply) => {
      const params = z.object({ shareId: z.string() }).parse(request.params)
      if (!request.auth) {
        reply.status(401).send(shareAccessError("UNAUTHORIZED", "Authentication required."))
        return
      }

      const share = await fastify.prisma.shareLink.findFirst({
        where: {
          id: params.shareId,
          createdById: request.auth.user.id,
          revokedAt: null,
        },
      })

      if (!share) {
        reply.status(404).send(shareAccessError("SHARE_NOT_FOUND", "Share link not found."))
        return
      }

      await fastify.prisma.shareLink.update({
        where: { id: share.id },
        data: { revokedAt: new Date() },
      })

      reply.send({ data: { success: true } })
    },
  )

  fastify.get("/shares/access/:token", async (request, reply) => {
    const params = z.object({ token: z.string().min(8) }).parse(request.params)
    const query = z
      .object({
        folderId: z.string().optional(),
        meta: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().optional(),
      })
      .parse(request.query ?? {})

    const resolved = await resolveShareByToken(fastify, params.token)
    if (!resolved.ok) {
      const messages: Record<typeof resolved.code, string> = {
        NOT_FOUND: "This share link is invalid.",
        REVOKED: "This share link was revoked.",
        EXPIRED: "This share link has expired.",
        VIEW_LIMIT: "This share link reached its view limit.",
      }
      reply.status(404).send(shareAccessError(resolved.code, messages[resolved.code]))
      return
    }

    const { share } = resolved
    if (query.meta !== "1" && query.meta !== "true") {
      await recordShareView(fastify, share.id)
    }

    if (share.resourceType === "ASSET" && share.asset) {
      const label =
        share.label?.trim() ||
        shareResourceLabel(share.resourceType, share.asset, share.folder)
      reply.send({
        data: {
          resourceType: "ASSET" as const,
          label,
          allowDownload: share.allowDownload,
          expiresAt: share.expiresAt?.toISOString() ?? null,
          asset: serializePublicAsset(share.asset),
        },
      })
      return
    }

    if (share.resourceType === "ASSETS") {
      const members = await fastify.prisma.shareLinkAsset.findMany({
        where: { shareLinkId: share.id },
        orderBy: { sortOrder: "asc" },
        include: { asset: true },
      })
      const assets = members
        .map((member) => member.asset)
        .filter((asset) => !asset.deletedAt && asset.status !== "DELETED")

      const label =
        share.label?.trim() ||
        shareResourceLabel(share.resourceType, null, null, assets.length)

      reply.send({
        data: {
          resourceType: "ASSETS" as const,
          label,
          allowDownload: share.allowDownload,
          expiresAt: share.expiresAt?.toISOString() ?? null,
          assets: assets.map(serializePublicAsset),
        },
      })
      return
    }

    if (share.resourceType !== "FOLDER" || !share.folder) {
      reply.status(404).send(shareAccessError("NOT_FOUND", "Shared content is unavailable."))
      return
    }

    const label =
      share.label?.trim() ||
      shareResourceLabel(share.resourceType, share.asset, share.folder)

    let activeFolder = share.folder
    if (query.folderId && query.folderId !== share.folder.id) {
      const nested = await assertFolderInShareScope(fastify, share, query.folderId)
      if (!nested) {
        reply.status(404).send(shareAccessError("NOT_FOUND", "Folder not found in this share."))
        return
      }
      activeFolder = nested
    }

    // Keyset pagination, not `take: 500`. The old fixed limit silently
    // truncated any shared folder holding more than 500 files: the recipient
    // saw a page that looked complete and was not. The cursor never widens the
    // filter — `folderId` is pinned to the folder already proven in-scope, so a
    // recipient cannot page their way out of the shared subtree.
    const limit = clampPageSize(query.limit)
    const cursor = decodeAssetCursor(query.cursor)
    const cursorWhere = buildCursorWhere(cursor)

    const assetWhere = {
      folderId: activeFolder.id,
      deletedAt: null,
      status: { not: "DELETED" as const },
      ...(cursorWhere ? { AND: [cursorWhere] } : {}),
    }

    const [childFolders, rows, assetCount] = await Promise.all([
      fastify.prisma.folder.findMany({
        where: {
          parentFolderId: activeFolder.id,
          deletedAt: null,
        },
        orderBy: { name: "asc" },
        include: {
          _count: { select: { assets: { where: { deletedAt: null, status: { not: "DELETED" } } } } },
        },
      }),
      fastify.prisma.asset.findMany({
        where: assetWhere,
        orderBy: ASSET_PAGE_ORDER_BY,
        take: limit + 1,
      }),
      // The count the recipient is shown must describe the same set they can
      // navigate, so it uses the filter without the cursor.
      fastify.prisma.asset.count({
        where: {
          folderId: activeFolder.id,
          deletedAt: null,
          status: { not: "DELETED" },
        },
      }),
    ])

    const page = buildAssetPage(rows, limit)

    reply.send({
      data: {
        resourceType: "FOLDER" as const,
        label,
        allowDownload: share.allowDownload,
        expiresAt: share.expiresAt?.toISOString() ?? null,
        folder: {
          id: activeFolder.id,
          name: activeFolder.name,
          slug: activeFolder.slug,
          rootFolderId: share.folder.id,
          folders: childFolders.map((f) =>
            serializePublicFolder(f, f._count.assets),
          ),
          assets: page.items.map(serializePublicAsset),
          assetCount,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        },
      },
    })
  })

  fastify.get("/shares/access/:token/download/:assetId", async (request, reply) => {
    const params = z
      .object({
        token: z.string().min(8),
        assetId: z.string(),
      })
      .parse(request.params)
    const query = z
      .object({
        inline: z.string().optional(),
      })
      .parse(request.query ?? {})

    const resolved = await resolveShareByToken(fastify, params.token)
    if (!resolved.ok) {
      reply.status(404).send(shareAccessError("NOT_FOUND", "Share link is not available."))
      return
    }

    const { share } = resolved

    const asset = await assertAssetInShareScope(fastify, share, params.assetId)
    if (!asset) {
      reply.status(404).send(shareAccessError("ASSET_NOT_FOUND", "File not found in this share."))
      return
    }

    const inlinePreview = query.inline === "1" || query.inline === "true"
    if (!inlinePreview && !share.allowDownload) {
      reply.status(403).send(shareAccessError("DOWNLOAD_DISABLED", "Downloads are disabled for this share."))
      return
    }
    const contentType = resolveInlineContentType(asset.mimeType, asset.extension)
    const disposition = inlinePreview
      ? `inline; filename="${asset.originalFilename.replace(/"/g, "")}"`
      : `attachment; filename="${asset.originalFilename.replace(/"/g, "")}"`

    await streamFileResponse(reply, {
      path: asset.storageObject.physicalPath,
      contentType,
      contentDisposition: disposition,
      rangeHeader: request.headers.range ?? null,
    })
  })

  fastify.get("/shares/access/:token/thumbnail/:assetId", async (request, reply) => {
    const params = z
      .object({
        token: z.string().min(8),
        assetId: z.string(),
      })
      .parse(request.params)

    const resolved = await resolveShareByToken(fastify, params.token)
    if (!resolved.ok) {
      reply.status(404).send(shareAccessError("NOT_FOUND", "Share link is not available."))
      return
    }

    const asset = await assertAssetInShareScope(fastify, resolved.share, params.assetId)
    if (!asset) {
      reply.status(404).send(shareAccessError("ASSET_NOT_FOUND", "File not found in this share."))
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
        reply.header("Cache-Control", "public, max-age=300")
        return reply.send(placeholder)
      }
      if (asset.mediaType === "VIDEO") {
        const placeholder = await renderVideoPlaceholderWebpBuffer()
        reply.header("content-type", "image/webp")
        reply.header("Cache-Control", "public, max-age=300")
        return reply.send(placeholder)
      }
      reply.status(404).send(shareAccessError("ASSET_NOT_FOUND", "Preview unavailable."))
      return
    }

    // Images used to stream the full original from this route, so a shared
    // folder of 60 photos made a recipient download hundreds of megabytes just
    // to draw the grid — on a phone the tiles simply never appeared. Serve the
    // same small thumbnail videos already use, and only fall back to the
    // original when one genuinely cannot be produced.
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
        mimeType: asset.mimeType,
        extension: asset.extension,
        originalFilename: asset.originalFilename,
        sourcePath: sourcePathResolved,
        thumbnailPath,
      })
    }

    try {
      await access(thumbnailPath)
      reply.header("content-type", "image/webp")
      reply.header("Cache-Control", "public, max-age=86400")
      return reply.send(createReadStream(thumbnailPath))
    } catch {
      if (asset.mediaType === "VIDEO") {
        const placeholder = await renderVideoPlaceholderWebpBuffer()
        reply.header("content-type", "image/webp")
        reply.header("Cache-Control", "public, max-age=300")
        return reply.send(placeholder)
      }
      if (asset.mediaType === "IMAGE") {
        // Thumbnailing failed (unusual format, corrupt file). The original is
        // still a correct preview — better a slow tile than an empty one.
        const contentType = resolveInlineContentType(asset.mimeType, asset.extension)
        reply.header("content-type", contentType)
        reply.header("Cache-Control", "public, max-age=86400")
        return reply.send(createReadStream(sourcePathResolved))
      }
      reply.status(404).send(shareAccessError("ASSET_NOT_FOUND", "Preview unavailable."))
    }
  })

  fastify.post("/shares/access/:token/feedback", async (request, reply) => {
    const params = z.object({ token: z.string().min(8) }).parse(request.params)
    const body = z
      .object({
        sentiment: z.enum(["LIKE", "DISLIKE"]),
        assetId: z.string().optional(),
      })
      .parse(request.body ?? {})

    const resolved = await resolveShareByToken(fastify, params.token)
    if (!resolved.ok) {
      const messages: Record<typeof resolved.code, string> = {
        NOT_FOUND: "This share link is invalid.",
        REVOKED: "This share link was revoked.",
        EXPIRED: "This share link has expired.",
        VIEW_LIMIT: "This share link reached its view limit.",
      }
      reply.status(404).send(shareAccessError(resolved.code, messages[resolved.code]))
      return
    }

    const result = await recordShareFeedback(
      fastify,
      resolved.share,
      body.sentiment,
      body.assetId,
    )

    if (!result.ok) {
      reply.status(404).send(shareAccessError("ASSET_NOT_FOUND", "File not found in this share."))
      return
    }

    reply.status(201).send({ data: { success: true } })
  })
}
