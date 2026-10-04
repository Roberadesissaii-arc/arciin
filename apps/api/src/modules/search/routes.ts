import type { FastifyInstance, FastifyRequest } from "fastify"
import type { MediaType, Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"

import {
  UNIVERSAL_SEARCH_LIMITS,
  UNIVERSAL_SEARCH_LITERAL_WINDOW,
  navigationMatchScore,
  normalizeUniversalQuery,
  rankUniversalFiles,
  rankUniversalFolders,
  semanticIndexVersion,
} from "@arciin/shared"

import { folderAccessGranted } from "@/services/folders/folder-lock"
import { resolveHiddenFromAllFilesFolderIds } from "@/services/folders/hidden-from-all-files"
import { computerLibraryIds, computerOwnerRestriction } from "@/services/libraries/library-view"
import { buildVisibleAssetWhere } from "@/services/libraries/visible-asset-query"
import { semanticSearchFor } from "@/services/search/hybrid-search"
import type { SemanticAvailability } from "@/services/search/semantic-search"
import { requireSessionRolesOrApiKeyScopes } from "@/services/security/auth"

/**
 * Universal search — the top search box.
 *
 * Two routes so one slow source never holds up another:
 *
 *   GET /search        keyword files, folders and libraries. Fast; no model.
 *   GET /search/files  the same file search with matches by meaning added
 *                      (the v1.1.2 hybrid search, unchanged).
 *
 * Visibility is the All Files rule set, plus two things a global search box
 * must not do that a library page never had to think about:
 *  - list a locked folder's contents to a session that has not unlocked it;
 *  - surface the legacy Computer Backup folder trees (thousands of raw
 *    device paths). Files from those backups stay findable exactly as in the
 *    Images/Videos views, shown under their media library and never with the
 *    backup folder path.
 */

const LIBRARY_FOR_MEDIA: Partial<Record<MediaType, string>> = {
  VIDEO: "videos",
  IMAGE: "images",
  AUDIO: "music",
  DOCUMENT: "documents",
}

const fileInclude = {
  library: { select: { id: true, name: true, slug: true, kind: true } },
  folder: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.AssetInclude

type FileRow = Prisma.AssetGetPayload<{ include: typeof fileInclude }>

function serializeFile(row: FileRow, match: { kind: string; label: string | null }, mediaLibraries: Map<string, { name: string; slug: string }>) {
  // A computer-backup file is presented where the user browses it: under its
  // media library, with no backup folder path.
  const backup = row.library.kind === "COMPUTER"
  const presented = backup ? mediaLibraries.get(LIBRARY_FOR_MEDIA[row.mediaType] ?? "") : null
  return {
    id: row.id,
    title: row.title,
    originalFilename: row.originalFilename,
    mediaType: row.mediaType,
    mimeType: row.mimeType,
    extension: row.extension,
    durationSeconds: row.durationSeconds,
    coverImageAt: row.coverImageAt ? row.coverImageAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    library: presented
      ? { id: null, name: presented.name, slug: presented.slug, kind: row.mediaType }
      : backup
        ? null
        : { id: row.library.id, name: row.library.name, slug: row.library.slug, kind: row.library.kind },
    folder: !backup && row.folder ? { id: row.folder.id, name: row.folder.name, slug: row.folder.slug } : null,
    match,
  }
}

/**
 * What a search must not reach into.
 *
 * `contents`: folders whose files stay out — hidden from All Files, or locked
 * (with everything below) and not unlocked by this session.
 * `folders`: folders that are not listed at all — hidden ones, and anything
 * *inside* a locked folder. The locked folder itself is listed, with its
 * lock, exactly as its library page shows it.
 */
async function excludedFolderIds(prisma: PrismaClient, request: FastifyRequest): Promise<{ contents: string[]; folders: string[] }> {
  const [hidden, locked] = await Promise.all([
    resolveHiddenFromAllFilesFolderIds(prisma),
    prisma.folder.findMany({
      where: { lockedAt: { not: null }, deletedAt: null },
      select: { id: true, libraryId: true, pathCache: true, lockedAt: true },
    }),
  ])
  const userId = request.auth!.user.id
  const denied = locked.filter((f) => !folderAccessGranted(request, userId, f, request.auth?.session ?? null))
  if (denied.length === 0) return { contents: hidden, folders: hidden }
  const nested = await prisma.folder.findMany({
    where: {
      deletedAt: null,
      OR: denied.map((f) => ({ libraryId: f.libraryId, pathCache: { startsWith: `${f.pathCache}/` } })),
    },
    select: { id: true },
  })
  const below = nested.map((f) => f.id)
  return {
    contents: [...new Set([...hidden, ...denied.map((f) => f.id), ...below])],
    folders: [...new Set([...hidden, ...below])],
  }
}

async function fileScope(prisma: PrismaClient, request: FastifyRequest) {
  const [excluded, computers, mediaLibraryRows] = await Promise.all([
    excludedFolderIds(prisma, request),
    computerLibraryIds(prisma),
    prisma.library.findMany({ where: { slug: { in: Object.values(LIBRARY_FOR_MEDIA) as string[] } }, select: { name: true, slug: true } }),
  ])
  const filters = {
    scope: { kind: "all" as const },
    hiddenFolderIds: excluded.contents,
    computerLibraryIds: computers,
    restrictComputerOwnerId: computerOwnerRestriction(request.auth!.user),
    archived: "exclude" as const,
  }
  return { filters, excluded, mediaLibraries: new Map(mediaLibraryRows.map((l) => [l.slug, l])) }
}

function literalFiles(prisma: PrismaClient, filters: Parameters<typeof buildVisibleAssetWhere>[0], q: string) {
  return prisma.asset.findMany({
    where: buildVisibleAssetWhere({ ...filters, search: q }),
    include: fileInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: UNIVERSAL_SEARCH_LITERAL_WINDOW,
  })
}

/**
 * How far the semantic index has got, only while it is still building — the
 * search panel shows "412 / 817 indexed" then, and nothing once it is done.
 * Cached briefly; it is a status line, not a gauge.
 */
const indexProgressCache = new WeakMap<PrismaClient, { at: number; value: { indexed: number; eligible: number } | null }>()
const INDEX_PROGRESS_TTL_MS = 30_000

async function semanticIndexProgress(prisma: PrismaClient): Promise<{ indexed: number; eligible: number } | null> {
  const cached = indexProgressCache.get(prisma)
  if (cached && Date.now() - cached.at < INDEX_PROGRESS_TTL_MS) return cached.value
  let value: { indexed: number; eligible: number } | null = null
  const config = await prisma.semanticSearchConfig.findUnique({ where: { id: "default" } })
  if (config?.enabled && config.indexingActive) {
    const version = semanticIndexVersion(config.rebuildEpoch)
    const [counts] = await prisma.$queryRaw<Array<{ eligible: number; done: number; indexed: number }>>`
      SELECT
        count(*)::int AS eligible,
        count(*) FILTER (WHERE s.status = 'INDEXED' AND s."embeddingModel" = ${config.embeddingModel} AND s."indexVersion" = ${version})::int AS indexed,
        count(*) FILTER (WHERE (s.status = 'INDEXED' AND s."embeddingModel" = ${config.embeddingModel} AND s."indexVersion" = ${version})
          OR s.status = 'FAILED' OR (s.status = 'SKIPPED' AND s."indexVersion" = ${version}))::int AS done
      FROM "Asset" a
      LEFT JOIN "AssetSemanticIndex" s ON s."assetId" = a.id
      WHERE a."deletedAt" IS NULL AND a.status = 'READY'
    `
    if (counts && counts.done < counts.eligible) value = { indexed: counts.indexed, eligible: counts.eligible }
  }
  indexProgressCache.set(prisma, { at: Date.now(), value })
  return value
}

const querySchema = z.object({
  q: z.string().max(1000).optional(),
})

export async function registerUniversalSearchRoutes(fastify: FastifyInstance) {
  const auth = requireSessionRolesOrApiKeyScopes(["OWNER", "ADMIN", "MEMBER", "VIEWER"], ["assets:read"])

  fastify.get("/search", { preHandler: auth }, async (request, reply) => {
    const q = normalizeUniversalQuery(querySchema.parse(request.query).q)
    reply.header("Cache-Control", "no-store")
    if (!q) {
      reply.send({ data: { query: q, files: [], folders: [], libraries: [] } })
      return
    }

    const { filters, excluded, mediaLibraries } = await fileScope(fastify.prisma, request)
    const literal = q.replace(/[\\%_]/g, (ch) => `\\${ch}`)

    const [files, folders, libraries] = await Promise.all([
      literalFiles(fastify.prisma, filters, q),
      fastify.prisma.folder.findMany({
        where: {
          deletedAt: null,
          id: excluded.folders.length ? { notIn: excluded.folders } : undefined,
          // Legacy Computer Backup trees are thousands of raw device paths.
          library: { kind: { not: "COMPUTER" } },
          OR: [
            { name: { contains: literal, mode: "insensitive" } },
            { pathCache: { contains: literal, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          slug: true,
          pathCache: true,
          lockedAt: true,
          library: { select: { id: true, name: true, slug: true, kind: true } },
        },
        orderBy: { pathCache: "asc" },
        take: UNIVERSAL_SEARCH_LITERAL_WINDOW,
      }),
      fastify.prisma.library.findMany({
        where: { kind: { not: "COMPUTER" } },
        select: { id: true, name: true, slug: true, kind: true },
        orderBy: { createdAt: "asc" },
      }),
    ])

    const rankedFolders = rankUniversalFolders(q, folders)
    const folderIds = rankedFolders.map((f) => f.id)
    const counts = folderIds.length
      ? await fastify.prisma.asset.groupBy({
          by: ["folderId"],
          where: { folderId: { in: folderIds }, deletedAt: null },
          _count: { _all: true },
        })
      : []
    const countBy = new Map(counts.map((c) => [c.folderId, c._count._all]))

    reply.send({
      data: {
        query: q,
        files: rankUniversalFiles(q, files, []).map(({ item, match }) => serializeFile(item, match, mediaLibraries)),
        folders: rankedFolders.map((f) => ({
          id: f.id,
          name: f.name,
          slug: f.slug,
          // Library-relative ("/movies/2026"), never a filesystem path.
          path: f.pathCache,
          isLocked: f.lockedAt != null,
          assetCount: countBy.get(f.id) ?? 0,
          library: f.library,
        })),
        libraries: libraries
          .map((library, index) => ({ library, index, score: navigationMatchScore(q, { title: library.name, keywords: [library.slug] }) }))
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .slice(0, UNIVERSAL_SEARCH_LIMITS.libraries)
          .map((row) => row.library),
      },
    })
  })

  fastify.get("/search/files", { preHandler: auth }, async (request, reply) => {
    const q = normalizeUniversalQuery(querySchema.parse(request.query).q)
    reply.header("Cache-Control", "no-store")
    if (!q) {
      reply.send({ data: { query: q, files: [], semantic: "used" satisfies SemanticAvailability, index: null } })
      return
    }

    // Meaning is looked up while the keyword query runs.
    const candidates = semanticSearchFor(fastify.prisma).candidates(q)
    const { filters, mediaLibraries } = await fileScope(fastify.prisma, request)
    const literalRows = await literalFiles(fastify.prisma, filters, q)
    const found = await candidates

    const literalIds = new Set(literalRows.map((row) => row.id))
    const wanted = found.hits.filter((hit) => !literalIds.has(hit.id)).slice(0, UNIVERSAL_SEARCH_LIMITS.files * 3)
    let semanticRows: Array<{ item: FileRow; score: number }> = []
    if (wanted.length) {
      // The same visible-asset where as the keyword query, minus the text:
      // a vector hit can never surface a file the listing would hide.
      const allowed = await fastify.prisma.asset.findMany({
        where: { AND: [buildVisibleAssetWhere(filters), { id: { in: wanted.map((h) => h.id) } }] },
        include: fileInclude,
      })
      const score = new Map(wanted.map((h) => [h.id, h.score]))
      semanticRows = allowed.map((item) => ({ item, score: score.get(item.id) ?? 0 }))
    }

    const index = found.status === "disabled" ? null : await semanticIndexProgress(fastify.prisma).catch(() => null)

    reply.send({
      data: {
        query: q,
        files: rankUniversalFiles(q, literalRows, semanticRows).map(({ item, match }) => serializeFile(item, match, mediaLibraries)),
        semantic: found.status,
        index,
      },
    })
  })
}
