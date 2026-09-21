import { createReadStream } from "node:fs"
import { access, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import {
  assetSupportsDocumentThumbnail,
  DEFAULT_USER_PREFERENCES,
  resolveInlineContentType,
} from "@arciin/shared"
import { resolveArciinStorageRoot } from "@arciin/storage"

import { apiConfig } from "@/config"
import { buildRealtimeEvent } from "@/services/events/publish-event"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"
import { assertAssetFolderAccess, assertFolderAccess } from "@/services/folders/folder-lock"
import { folderAccessGranted } from "@/services/folders/folder-lock"
import {
  MAX_MOVES_PER_BATCH,
  moveLibraryAssets,
} from "@/services/assets/move-library-assets"
import { checkEndpointRateLimit } from "@/services/security/endpoint-rate-limit"
import { resolveHiddenFromAllFilesFolderIds } from "@/services/folders/hidden-from-all-files"
import { buildVisibleAssetWhere } from "@/services/libraries/visible-assets"
import {
  computerLibraryIds,
  computerOwnerRestriction,
  resolveSmartLibraryScope,
} from "@/services/libraries/library-view"
import {
  ASSET_PAGE_ORDER_BY,
  buildAssetPage,
  buildCursorWhere,
  clampPageSize,
  decodeAssetCursor,
} from "@/services/libraries/asset-pagination"
import {
  ensureThumbnailWritten,
  renderImageWebpThumbnailBuffer,
  renderVideoPlaceholderWebpBuffer,
  renderImagePlaceholderWebpBuffer,
  resolveReadableObjectPath,
  resolvedThumbnailPath,
} from "@/services/media/thumbnail-cache"
import { generateAssetCoverImage } from "@/services/media/generate-cover-image"
import { ensureBrowserPlayableVideo } from "@/services/media/browser-playable-video"
import { streamFileResponse } from "@/services/media/stream-file-response"
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
import { signMediaToken } from "@/services/security/media-token"
import { requireAssetMediaAccess, requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"
import { getPdfNavigationIndex } from "@/services/chat/read-pdf-asset"
import { serializeAsset } from "@/services/serializers"
import { loadAssetAiSummaries, withAiSummaries } from "@/services/assets/ai-summary"
import { loadUserPreferences } from "@/services/user/preferences"

/** Batched AI badges + heal stuck transcripts so hard-killed workers clear cards. */
async function loadAiSummariesForPage(fastify: FastifyInstance, assetIds: string[]) {
  const heartbeatRaw = await fastify.redis.get(apiConfig.workerHeartbeatKey).catch(() => null)
  const workerHeartbeatMs = heartbeatRaw ? Number(heartbeatRaw) : null
  return loadAssetAiSummaries(fastify.prisma, assetIds, {
    workerHeartbeatMs: Number.isFinite(workerHeartbeatMs) ? workerHeartbeatMs : null,
    onHealed: async (healed) => {
      await fastify
        .publishRealtimeEvent(
          buildRealtimeEvent("asset.transcript.failed", {
            assetId: healed.assetId,
            message: healed.error,
            data: { transcriptId: healed.transcriptId, healed: true },
          }),
        )
        .catch(() => {})
    },
  })
}

/**
 * MIME types safe to render inline in the browser. Everything else (SVG, HTML,
 * XML, unknown) is served as a download so uploaded active content can't run
 * script on the app origin. SVG is deliberately excluded despite being image/*.
 */
const INLINE_SAFE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "application/pdf",
  "text/plain",
])

const assetUpdateSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  originalFilename: z.string().min(1).max(255).optional(),
  badgeLabel: z.string().min(1).max(32).nullable().optional(),
  badgeColor: z
    .string()
    .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/)
    .nullable()
    .optional(),
  showBadge: z.boolean().optional(),
})

const assetMoveSchema = z.object({
  folderId: z.string().optional(),
  libraryId: z.string().optional(),
})

/**
 * Bulk reparent.
 *
 * Organising a library is inherently a batch: doing it one HTTP round trip at a
 * time turns 246 books into 246 requests, each with its own chance to fail
 * halfway. One call, one audit entry, one result per file.
 */
const assetBatchMoveSchema = z.object({
  moves: z
    .array(
      z.object({
        assetId: z.string().min(1),
        destinationFolderId: z.string().min(1).nullable(),
      }),
    )
    .min(1)
    .max(MAX_MOVES_PER_BATCH),
})

const assetIdParamsSchema = z.object({ assetId: z.string() })

/** Upper bound on a single asset listing. The UI reports truncation explicitly. */
const ASSET_LIST_LIMIT = 1000

const deleteAssetPreHandler = requireSessionRolesOrApiKeyScopes(
  ["OWNER", "ADMIN", "MEMBER"],
  ["assets:write"],
)

async function handleSoftDeleteAsset(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = assetIdParamsSchema.parse(request.params)

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
    where: { id: params.assetId },
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
      title: "Moved to Trash",
      message: `${asset.originalFilename} was moved to Trash. It will be permanently deleted after 30 days.`,
      entityType: "asset",
      entityId: asset.id,
    })
    await fastify.publishRealtimeEvent(
      buildRealtimeEvent("asset.deleted", {
        userId: request.auth.user.id,
        libraryId: asset.libraryId,
        assetId: asset.id,
        message: `${asset.originalFilename} moved to Trash.`,
      }),
    )
  }

  reply.send({
    data: {
      success: true,
    },
  })
}

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
          /** Library root browse: only assets not inside a folder (avoids folder uploads crowding out the take window). */
          rootOnly: z
            .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0")])
            .optional()
            .transform((v) => v === "true" || v === "1"),
          mediaType: z.string().optional(),
          category: z.enum(["code", "applications", "other"]).optional(),
          search: z.string().optional(),
          ids: z.string().optional(),
          /** Opt in to Inbox for "what did I just upload" style queries (chat). */
          includeInbox: z
            .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0")])
            .optional()
            .transform((v) => v === "true" || v === "1"),
          /**
           * `only` = Archives chip (user-archived files).
           * Default excludes archived from main libraries / All Files.
           */
          archived: z.enum(["exclude", "only", "include"]).optional(),
        })
        .parse(request.query)

      if (query.folderId) {
        const allowed = await assertFolderAccess(fastify, request, reply, query.folderId)
        if (!allowed) return
      }

      const idList = query.ids
        ? query.ids.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20)
        : undefined

      const archivedMode = query.archived ?? "exclude"

      // All Files + Overview (no folder scope): exclude assets in hidden folders
      // and every nested folder under them. Open the folder itself to browse.
      const excludeHiddenRemoteFolders =
        !query.folderId && !query.rootOnly && !idList?.length

      const hiddenFolderIds = excludeHiddenRemoteFolders
        ? await resolveHiddenFromAllFilesFolderIds(fastify.prisma)
        : []

      // Only an undirected cross-library browse hides Inbox. Every deliberate
      // request still finds it: opening Inbox, searching by name, asking for a
      // category — Applications lives almost entirely in Inbox, so applying
      // this there emptied the one page whose job is to list installers — or
      // asking chat what was uploaded last, where an unclassified file is
      // precisely the answer and hiding it names the wrong file.
      // Archives / Other chips also need Inbox (zips and unclassified land there).
      const excludeLibraryIds =
        !query.libraryId &&
        !query.folderId &&
        !query.search &&
        !query.category &&
        !query.includeInbox &&
        archivedMode !== "only" &&
        !idList?.length
          ? (
              await fastify.prisma.library.findMany({
                where: { kind: "INBOX" },
                select: { id: true },
              })
            ).map((l) => l.id)
          : []

      const assets = await fastify.prisma.asset.findMany({
        where: idList?.length
          ? {
              deletedAt: null,
              id: { in: idList },
              ...(archivedMode === "only"
                ? { archivedAt: { not: null } }
                : archivedMode === "exclude"
                  ? { archivedAt: null }
                  : {}),
            }
          : buildVisibleAssetWhere({
              scope: await resolveSmartLibraryScope(fastify.prisma, query),
              hiddenFolderIds,
              excludeLibraryIds,
              computerLibraryIds: await computerLibraryIds(fastify.prisma),
              restrictComputerOwnerId: request.auth
                ? computerOwnerRestriction(request.auth.user)
                : null,
              mediaType: query.mediaType,
              category: query.category,
              search: query.search,
              archived: archivedMode,
            }),
        orderBy: {
          createdAt: "desc",
        },
        // Library views browse recursively so the list can be reconciled with
        // the sidebar count; a 200-row cap silently truncated any library
        // larger than that and reintroduced the count/list mismatch. Still
        // bounded — real pagination is tracked separately.
        take: query.category ? 500 : ASSET_LIST_LIMIT,
      })

      reply.send({
        // Batched for the whole page — a request per card would be two hundred
        // requests to draw two hundred badges.
        data: withAiSummaries(
          assets.map(serializeAsset),
          await loadAiSummariesForPage(
            fastify,
            assets.map((a) => a.id),
          ),
        ),
      })
    }
  )

  /**
   * Cursor-paginated asset listing.
   *
   * A separate route from `GET /assets` so the documented array response other
   * clients (chat context, share pages, the mobile app) depend on stays exactly
   * as it was. Library and folder browsing use this one.
   */
  fastify.get(
    "/assets/page",
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
          rootOnly: z
            .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0")])
            .optional()
            .transform((v) => v === "true" || v === "1"),
          mediaType: z.string().optional(),
          category: z.enum(["code", "applications", "other"]).optional(),
          search: z.string().optional(),
          includeInbox: z
            .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0")])
            .optional()
            .transform((v) => v === "true" || v === "1"),
          archived: z.enum(["exclude", "only", "include"]).optional(),
          cursor: z.string().optional(),
          limit: z.coerce.number().int().positive().optional(),
          /** Total is a second query; ask for it only on the first page. */
          withTotal: z
            .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0")])
            .optional()
            .transform((v) => v === "true" || v === "1"),
        })
        .parse(request.query)

      if (query.folderId) {
        const allowed = await assertFolderAccess(fastify, request, reply, query.folderId)
        if (!allowed) return
      }

      const scope = await resolveSmartLibraryScope(fastify.prisma, query)
      const archivedMode = query.archived ?? "exclude"

      const hiddenFolderIds =
        !query.folderId && !query.rootOnly
          ? await resolveHiddenFromAllFilesFolderIds(fastify.prisma)
          : []

      // Same rule as the unpaginated listing above.
      const excludeLibraryIds =
        !query.libraryId &&
        !query.folderId &&
        !query.search &&
        !query.category &&
        !query.includeInbox &&
        archivedMode !== "only"
          ? (
              await fastify.prisma.library.findMany({
                where: { kind: "INBOX" },
                select: { id: true },
              })
            ).map((l) => l.id)
          : []

      // The count and the page share one where-builder, minus the cursor —
      // that is what keeps "showing X of Y" honest.
      const filters = {
        scope,
        hiddenFolderIds,
        excludeLibraryIds,
        computerLibraryIds: await computerLibraryIds(fastify.prisma),
        restrictComputerOwnerId: request.auth
          ? computerOwnerRestriction(request.auth.user)
          : null,
        mediaType: query.mediaType,
        category: query.category,
        search: query.search,
        archived: archivedMode,
      }

      const limit = clampPageSize(query.limit)

      const rows = await fastify.prisma.asset.findMany({
        where: buildVisibleAssetWhere({
          ...filters,
          cursor: buildCursorWhere(decodeAssetCursor(query.cursor)),
        }),
        orderBy: ASSET_PAGE_ORDER_BY,
        // One extra row is the cheapest reliable hasMore signal.
        take: limit + 1,
      })

      const page = buildAssetPage(rows, limit)

      const total = query.withTotal
        ? await fastify.prisma.asset.count({ where: buildVisibleAssetWhere(filters) })
        : undefined

      reply.send({
        data: {
          items: withAiSummaries(
            page.items.map(serializeAsset),
            await loadAiSummariesForPage(
              fastify,
              page.items.map((a) => a.id),
            ),
          ),
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          ...(total !== undefined ? { total } : {}),
        },
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

      if (!(await assertAssetFolderAccess(fastify, request, reply, asset.folderId))) {
        return
      }

      const withContext = serializeAsset(asset)
      reply.send({
        data: withContext,
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

      if (
        parsed.data.originalFilename !== undefined &&
        false
      ) {
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
    { preHandler: deleteAssetPreHandler },
    async (request, reply) => handleSoftDeleteAsset(fastify, request, reply),
  )

  /** POST alias for mobile clients (iOS PWA can fail CORS preflight on DELETE). */
  fastify.post(
    "/assets/:assetId/delete",
    { preHandler: deleteAssetPreHandler },
    async (request, reply) => handleSoftDeleteAsset(fastify, request, reply),
  )

  /**
   * Soft-archive: hide from main libraries / All Files chips, show under Archives.
   * Not Trash — file stays on disk and can be unarchived.
   */
  fastify.post(
    "/assets/:assetId/archive",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["assets:write"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      const asset = await fastify.prisma.asset.findFirst({
        where: { id: params.assetId, deletedAt: null },
      })
      if (!asset) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Asset not found." },
        })
        return
      }
      const updated = await fastify.prisma.asset.update({
        where: { id: asset.id },
        data: { archivedAt: asset.archivedAt ?? new Date() },
      })
      reply.send({ data: serializeAsset(updated) })
    },
  )

  fastify.post(
    "/assets/:assetId/unarchive",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["assets:write"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      const asset = await fastify.prisma.asset.findFirst({
        where: { id: params.assetId, deletedAt: null },
      })
      if (!asset) {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Asset not found." },
        })
        return
      }
      const updated = await fastify.prisma.asset.update({
        where: { id: asset.id },
        data: { archivedAt: null },
      })
      reply.send({ data: serializeAsset(updated) })
    },
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

      /**
       * Locked folders were not checked here.
       *
       * Every other asset route asserts folder access before touching a file —
       * this one only checked the caller's role, so a locked folder could be
       * emptied, or filled, by anyone who could reach the endpoint. The lock is
       * meant to hold until someone answers it with a password or a vault PIN.
       */
      if (!(await assertAssetFolderAccess(fastify, request, reply, current.folderId))) {
        return
      }
      if (nextFolderId && !(await assertAssetFolderAccess(fastify, request, reply, nextFolderId))) {
        return
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

  fastify.post(
    "/assets/move",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["assets:write"],
      ),
    },
    async (request, reply) => {
      const parsed = assetBatchMoveSchema.safeParse(request.body)
      if (!parsed.success) {
        reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: `Provide 1-${MAX_MOVES_PER_BATCH} moves.`,
            details: parsed.error.flatten(),
          },
        })
        return
      }

      const userId = request.auth?.user.id
      if (!userId) {
        reply.status(401).send({
          error: { code: "UNAUTHORIZED", message: "Authentication required." },
        })
        return
      }

      const result = await moveLibraryAssets({
        prisma: fastify.prisma,
        userId,
        moves: parsed.data.moves,
        // Session-aware, so a folder the user has already unlocked this session
        // stays usable — unlike the assistant, a person can answer the prompt.
        folderAccessGranted: (folder) =>
          folderAccessGranted(request, userId, folder, request.auth?.session ?? null),
        publishRealtimeEvent: (event) => fastify.publishRealtimeEvent(event),
        source: "api",
      })

      reply.send({ data: result })
    },
  )

  fastify.get(
    "/assets/:assetId/pdf-navigation-index",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read"],
      ),
    },
    async (request, reply) => {
      const params = assetIdParamsSchema.parse(request.params)
      const asset = await fastify.prisma.asset.findFirst({
        where: { id: params.assetId, deletedAt: null },
        select: { folderId: true },
      })
      if (!asset) {
        reply.status(404).send({
          error: { code: "ASSET_NOT_FOUND", message: "Asset not found." },
        })
        return
      }
      if (!(await assertAssetFolderAccess(fastify, request, reply, asset.folderId))) {
        return
      }
      const result = await getPdfNavigationIndex(fastify.prisma, params.assetId)
      if ("error" in result) {
        reply.status(400).send({
          error: { code: result.error, message: result.message },
        })
        return
      }
      reply.send({ data: result })
    },
  )

  /**
   * Mint a short-lived token for one asset so `<video>` / `<img>` URLs do not
   * have to carry a session credential in the query string.
   */
  fastify.post(
    "/assets/:assetId/media-token",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      const body = z
        .object({ scope: z.enum(["stream", "download"]).optional() })
        .parse(request.body ?? {})

      const asset = await fastify.prisma.asset.findFirst({
        where: { id: params.assetId },
        select: { id: true },
      })
      if (!asset) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Asset not found." } })
        return
      }

      const signed = signMediaToken({
        assetId: asset.id,
        userId: request.auth!.user.id,
        scope: body.scope ?? "stream",
      })
      reply.send({ data: signed })
    },
  )

  fastify.get(
    "/assets/:assetId/download",
    {
      preHandler: requireAssetMediaAccess(
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

      if (!(await assertAssetFolderAccess(fastify, request, reply, asset.folderId))) {
        return
      }

      const requestedContentType = inlinePreview
        ? resolveInlineContentType(asset.mimeType, asset.originalFilename)
        : asset.mimeType

      // Only render a known-safe set of types inline. SVG/HTML/XML and unknown
      // types are active content that could run script on the app origin, so we
      // force them to download regardless of the inline flag.
      const inlineSafe =
        inlinePreview &&
        INLINE_SAFE_MIME_TYPES.has(requestedContentType.split(";")[0]!.trim().toLowerCase())

      const contentType = inlineSafe ? requestedContentType : asset.mimeType
      let contentDisposition: string | null = null
      if (inlineSafe) {
        contentDisposition = "inline"
      } else {
        // Sanitize the filename to prevent header injection via quotes, newlines, etc.
        // Use RFC 5987 percent-encoding for the filename* parameter so arbitrary
        // Unicode characters (and ASCII control chars) are safe.
        const safeAscii = asset.originalFilename.replace(/[^\w.\- ]/g, "_")
        const encodedName = encodeURIComponent(asset.originalFilename)
        contentDisposition = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodedName}`
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

      // Defense-in-depth for served files: never sniff, and sandbox anything
      // not rendered inline so an uploaded document can't execute on our origin.
      reply.header("X-Content-Type-Options", "nosniff")
      if (!inlineSafe) {
        reply.header("Content-Security-Policy", "sandbox; default-src 'none'")
      }

      /**
       * VP9/AV1-in-MP4 (and HEVC) often play as audio-only in Chrome. Remux or
       * lightly transcode once, cache under thumbnails/playable/, and serve that
       * for both inline preview and downloads that need to play in a browser.
       */
      let servePath = resolvedPath
      let serveType = contentType
      let serveDisposition = contentDisposition
      if (asset.mediaType === "VIDEO") {
        try {
          const playable = await ensureBrowserPlayableVideo({
            sourcePath: resolvedPath,
            storageRoot: resolvedRoot,
            assetId: asset.id,
            codec: asset.codec,
            mimeType: asset.mimeType,
          })
          if (playable) {
            servePath = playable.path
            serveType = playable.contentType
            if (inlineSafe) {
              serveDisposition = "inline"
            } else {
              const base = asset.originalFilename.replace(/\.[^.]+$/, "") || "video"
              const ext = playable.contentType.includes("webm") ? "webm" : "mp4"
              const name = `${base}.${ext}`
              const safeAscii = name.replace(/[^\w.\- ]/g, "_")
              serveDisposition = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(name)}`
            }
          }
        } catch {
          // Fall through to the original file if remux fails.
        }
      }

      return streamFileResponse(reply, {
        path: servePath,
        contentType: serveType,
        contentDisposition: serveDisposition,
        rangeHeader: request.headers.range ?? null,
      })
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
          filenames: z.array(z.string().min(1).max(255)).min(1).max(200),
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

  /**
   * Draw a cover for a document from what it is about.
   *
   * Writes to the same path the thumbnail route already serves, so the card
   * picks it up on the next load with no schema change and no new plumbing.
   * Regenerating overwrites; deleting the file falls back to the page render.
   */
  fastify.post(
    "/assets/:assetId/cover",
    {
      preHandler: requireSessionRolesOrApiKeyScopes(
        ["OWNER", "ADMIN", "MEMBER"],
        ["assets:write"],
      ),
    },
    async (request, reply) => {
      if (!request.auth) return

      /**
       * Each cover is a paid image generation, so an unthrottled endpoint is a
       * way to spend the instance owner's balance rather than to attack it.
       * Twelve an hour is far above drawing covers for a shelf of books by hand
       * and far below what a loop would manage.
       */
      if (
        await checkEndpointRateLimit(request, reply, {
          key: `cover:user:${request.auth.user.id}`,
          limit: 12,
          windowSec: 3600,
        })
      ) {
        return
      }

      const { assetId } = request.params as { assetId?: string }
      if (!assetId) {
        reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Missing asset id." } })
        return
      }

      /**
       * A locked folder must gate this too.
       *
       * Drawing a cover reads the document's text and sends it to a third-party
       * image service. Without this check any MEMBER could have the contents of
       * a folder they cannot open shipped off the instance — the picture is the
       * visible part, the exfiltration is the real one.
       */
      const target = await fastify.prisma.asset.findFirst({
        where: { id: assetId, deletedAt: null },
        select: { folderId: true },
      })
      if (!target) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "That file no longer exists." } })
        return
      }
      if (!(await assertAssetFolderAccess(fastify, request, reply, target.folderId))) return

      const result = await generateAssetCoverImage(fastify, assetId)
      if (!result.ok) {
        reply
          .status(result.code === "NOT_FOUND" ? 404 : 400)
          .send({ error: { code: result.code, message: result.message } })
        return
      }
      reply.send({ data: { assetId, prompt: result.prompt } })
    },
  )

  fastify.get(
    "/assets/:assetId/thumbnail",
    {
      preHandler: requireAssetMediaAccess(
        ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
        ["assets:read"],
      ),
    },
    async (request, reply) => {
      const params = z.object({ assetId: z.string() }).parse(request.params)
      // Allow soft-deleted assets so Settings → Trash can show previews.
      const asset = await fastify.prisma.asset.findFirst({
        where: { id: params.assetId },
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

      // Folder lock only applies to live library assets; Trash previews skip it.
      if (!asset.deletedAt) {
        if (!(await assertAssetFolderAccess(fastify, request, reply, asset.folderId))) {
          return
        }
      }

      const userPrefs = request.auth?.user?.id
        ? await loadUserPreferences(fastify.prisma, request.auth.user.id)
        : null
      const documentThumbsEnabled =
        userPrefs?.media.documentThumbnails ??
        DEFAULT_USER_PREFERENCES.media.documentThumbnails
      const wantsDocumentThumb =
        documentThumbsEnabled &&
        assetSupportsDocumentThumbnail(
          asset.mediaType,
          asset.mimeType,
          asset.extension,
          asset.originalFilename,
        )

      const instance = await fastify.prisma.instanceConfig.findFirst()

      const sourcePathResolved = await resolveReadableObjectPath({
        configuredStorageRoot: instance?.storageRoot,
        physicalPath: asset.storageObject.physicalPath,
        objectKey: asset.storageObject.objectKey,
        extraRoots: [apiConfig.dataDir, asset.library?.storageLocation?.rootPath],
      })

      if (!sourcePathResolved) {
        // A thumbnail generated while the original still existed is perfectly
        // good on its own. Falling straight through to a placeholder meant an
        // asset whose original went missing showed a grey icon on the web even
        // though a real preview was sitting on disk (mobile kept showing it
        // from its own cache, which is what made the two clients disagree).
        const cachedThumb = resolvedThumbnailPath(
          instance?.storageRoot,
          asset.id,
          asset.storageObject.physicalPath,
        )
        try {
          await access(cachedThumb)
          reply.header("content-type", "image/webp")
          reply.header("Cache-Control", "private, max-age=86400")
          return reply.send(createReadStream(cachedThumb))
        } catch {
          /* no cached thumbnail — fall through to the placeholder */
        }

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

      let generatedThumb = false
      if (
        !hadFile &&
        (asset.mediaType === "VIDEO" ||
          asset.mediaType === "IMAGE" ||
          wantsDocumentThumb)
      ) {
        generatedThumb = await ensureThumbnailWritten({
          assetId: asset.id,
          mediaType: asset.mediaType,
          mimeType: asset.mimeType,
          extension: asset.extension,
          originalFilename: asset.originalFilename,
          sourcePath: sourcePathResolved,
          thumbnailPath,
        })
      }

      if (generatedThumb && wantsDocumentThumb) {
        await fastify.prisma.asset.update({
          where: { id: asset.id },
          data: { updatedAt: new Date() },
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

      if (!wantsDocumentThumb) {
        reply.status(404).send({
          error: {
            code: "THUMBNAIL_DISABLED",
            message: "Document thumbnails are disabled. Enable them in Settings → Storage.",
          },
        })
        return
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
