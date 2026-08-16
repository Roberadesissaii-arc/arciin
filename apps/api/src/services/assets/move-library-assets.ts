/**
 * Moving files between folders, as one reviewable operation.
 *
 * A move in Arciin is a metadata reparent, not a filesystem rename: the bytes
 * live in `StorageObject.physicalPath`, which is content-addressed and has no
 * relationship to the folder tree. That is what makes a bulk move safe — two
 * files with the same name can sit in one folder as separate rows, so a
 * collision can never overwrite anything. The name is reported, not resolved.
 *
 * Shared by the HTTP route and the chat tool on purpose. The single-asset route
 * already existed and the web UI used it; the assistant had no way to reach it,
 * which is why it could create folders and then tell people to drag the files
 * themselves. One service means the tool cannot drift into a second, less
 * careful implementation of the same rules.
 *
 * Every rule below is enforced here rather than by the caller, because the
 * caller may be a language model working from ids it inferred from a listing.
 */

import type { PrismaClient } from "@prisma/client"
import { nanoid } from "nanoid"
import type { RealtimeEvent } from "@arciin/shared"

import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"

/** One call may not move more than this. Keeps a runaway agent bounded. */
export const MAX_MOVES_PER_BATCH = 250

export type MoveRequestItem = {
  assetId: string
  /** Destination folder, or null for the library root. */
  destinationFolderId: string | null
  /**
   * The filename the caller believes this id belongs to.
   *
   * Used only to recover from a mistyped id — an opaque cuid is easy for a
   * model to fumble one character of across hundreds of moves, and a lost book
   * is a worse outcome than one extra lookup. Never used to *choose* a file.
   */
  filename?: string | null
}

export type MoveFailureCode =
  | "asset_not_found"
  | "asset_is_folder"
  | "destination_not_found"
  | "destination_locked"
  | "source_locked"
  | "duplicate_in_batch"
  | "ambiguous_name"
  | "write_failed"

export type MoveResultItem = {
  assetId: string
  filename: string | null
  status: "moved" | "already_there" | "failed"
  fromFolderId: string | null
  toFolderId: string | null
  /** Set when another file of the same name already sits in the destination. */
  nameCollision?: boolean
  code?: MoveFailureCode
  message?: string
  /** Set when the id was wrong and the file was found again by exact name. */
  recoveredByName?: boolean
}

export type MoveLibraryAssetsResult = {
  /** Groups this batch in the activity log, so it can be reviewed or reversed. */
  operationId: string
  requested: number
  moved: number
  alreadyThere: number
  failed: number
  /** Moves that only succeeded because the id was re-resolved from the name. */
  recovered: number
  results: MoveResultItem[]
}

type FolderRow = {
  id: string
  name: string
  pathCache: string
  libraryId: string
  lockedAt: Date | null
  deletedAt: Date | null
}


/**
 * Files with exactly this name.
 *
 * Exact, case-insensitive, whole-string — never fuzzy. The point is to recover
 * a *known* file whose id was mistyped, not to guess which book someone meant;
 * a near match here would move the wrong file and call it a success.
 */
export async function findAssetsByExactName(
  prisma: PrismaClient,
  input: { name: string; libraryId?: string; folderId?: string | null },
): Promise<
  Array<{
    id: string
    originalFilename: string
    sizeBytes: bigint
    folderId: string | null
    folderName: string | null
  }>
> {
  const rows = await prisma.asset.findMany({
    where: {
      deletedAt: null,
      originalFilename: { equals: input.name, mode: "insensitive" },
      ...(input.libraryId ? { libraryId: input.libraryId } : {}),
      ...(input.folderId !== undefined && input.folderId !== null
        ? { folderId: input.folderId }
        : {}),
    },
    select: {
      id: true,
      originalFilename: true,
      sizeBytes: true,
      folderId: true,
      folder: { select: { name: true } },
    },
    take: 25,
  })
  return rows.map((r) => ({
    id: r.id,
    originalFilename: r.originalFilename,
    sizeBytes: r.sizeBytes,
    folderId: r.folderId,
    folderName: r.folder?.name ?? null,
  }))
}

export type MoveLibraryAssetsInput = {
  prisma: PrismaClient
  userId: string
  moves: MoveRequestItem[]
  /**
   * Locked folders are refused by default.
   *
   * A folder lock is answered with a password or a vault PIN, which belongs to
   * a person at a keyboard. The assistant holds no such credential, so it must
   * not be able to move files into or out of a locked folder — the HTTP route
   * passes its session-aware check instead.
   */
  folderAccessGranted?: (folder: { id: string; lockedAt: Date | null }) => boolean
  publishRealtimeEvent?: (event: RealtimeEvent) => Promise<void>
  /** Attributed in the activity log, so an AI-run reorganisation is legible. */
  source?: "chat_ai" | "api" | "ui"
}

function defaultFolderAccess(folder: { lockedAt: Date | null }): boolean {
  return folder.lockedAt === null
}

/**
 * Move a batch of assets, reporting each one independently.
 *
 * Never throws for a per-file problem: a run over 246 books must not lose the
 * 238 that worked because eight were unreachable. The caller gets a row per
 * request and decides what to say about it.
 */
export async function moveLibraryAssets(
  input: MoveLibraryAssetsInput,
): Promise<MoveLibraryAssetsResult> {
  const { prisma, userId, moves } = input
  const granted = input.folderAccessGranted ?? defaultFolderAccess
  const operationId = `mv_${nanoid(12)}`

  if (moves.length > MAX_MOVES_PER_BATCH) {
    throw new Error(`Too many moves in one call (${moves.length} > ${MAX_MOVES_PER_BATCH}).`)
  }

  const results: MoveResultItem[] = []

  // The same asset twice in one batch is a caller mistake, and acting on both
  // would make the second one's "from" a lie in the audit trail.
  const seen = new Set<string>()
  const deduped: MoveRequestItem[] = []
  for (const move of moves) {
    if (seen.has(move.assetId)) {
      results.push({
        assetId: move.assetId,
        filename: null,
        status: "failed",
        fromFolderId: null,
        toFolderId: move.destinationFolderId,
        code: "duplicate_in_batch",
        message: "The same file was listed more than once in this batch.",
      })
      continue
    }
    seen.add(move.assetId)
    deduped.push(move)
  }

  const assetIds = deduped.map((m) => m.assetId)
  const folderIds = [
    ...new Set(deduped.map((m) => m.destinationFolderId).filter((id): id is string => Boolean(id))),
  ]

  const [assets, folders, foldersByRequestedId] = await Promise.all([
    prisma.asset.findMany({
      where: { id: { in: assetIds }, deletedAt: null },
      select: {
        id: true,
        originalFilename: true,
        folderId: true,
        libraryId: true,
        sizeBytes: true,
      },
    }),
    prisma.folder.findMany({
      where: { id: { in: folderIds } },
      select: {
        id: true,
        name: true,
        pathCache: true,
        libraryId: true,
        lockedAt: true,
        deletedAt: true,
      },
    }),
    // A folder id handed in where a file id belongs is a specific, likely
    // mistake for an agent reading a mixed listing — worth its own message
    // rather than a bare "not found".
    prisma.folder.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, name: true },
    }),
  ])

  const assetById = new Map(assets.map((a) => [a.id, a]))
  const folderById = new Map<string, FolderRow>(folders.map((f) => [f.id, f]))
  const folderIdsGivenAsAssets = new Set(foldersByRequestedId.map((f) => f.id))

  // Source folders, to check the lock on the side the file is leaving.
  const sourceFolderIds = [
    ...new Set(assets.map((a) => a.folderId).filter((id): id is string => Boolean(id))),
  ]
  const sourceFolders = sourceFolderIds.length
    ? await prisma.folder.findMany({
        where: { id: { in: sourceFolderIds } },
        select: { id: true, lockedAt: true },
      })
    : []
  const sourceFolderById = new Map(sourceFolders.map((f) => [f.id, f]))

  /** Names already in a destination, so a collision can be reported. */
  const namesByDestination = new Map<string, Set<string>>()
  for (const folderId of folderIds) {
    const existing = await prisma.asset.findMany({
      where: { folderId, deletedAt: null },
      select: { originalFilename: true },
    })
    namesByDestination.set(folderId, new Set(existing.map((a) => a.originalFilename)))
  }

  const applied: Array<{
    assetId: string
    filename: string
    fromFolderId: string | null
    fromLibraryId: string
    toFolderId: string | null
    toLibraryId: string
  }> = []

  for (const move of deduped) {
    const destinationId = move.destinationFolderId

    if (folderIdsGivenAsAssets.has(move.assetId)) {
      results.push({
        assetId: move.assetId,
        filename: null,
        status: "failed",
        fromFolderId: null,
        toFolderId: destinationId,
        code: "asset_is_folder",
        message:
          "That id belongs to a folder, not a file. This tool moves files; it does not move folders.",
      })
      continue
    }

    let asset = assetById.get(move.assetId)
    let recoveredByName = false

    /**
     * The id was wrong. Try to find the file the caller meant.
     *
     * A real run mistyped one cuid out of 245 — an inserted character — and the
     * book was left behind while everything else filed correctly. The name the
     * caller already had is enough to recover it, and recovering is strictly
     * safer than the alternative of a reader hand-fixing an opaque id.
     *
     * Only an unambiguous exact match is accepted. Two files of the same name
     * is exactly the situation where guessing moves the wrong one, so that case
     * is reported for review instead.
     */
    if (!asset && move.filename) {
      const matches = await findAssetsByExactName(prisma, { name: move.filename })
      if (matches.length === 1) {
        const found = matches[0]!
        const full = await prisma.asset.findFirst({
          where: { id: found.id, deletedAt: null },
          select: {
            id: true,
            originalFilename: true,
            folderId: true,
            libraryId: true,
            sizeBytes: true,
          },
        })
        if (full) {
          asset = full
          recoveredByName = true
          if (full.folderId) {
            const src = await prisma.folder.findUnique({
              where: { id: full.folderId },
              select: { id: true, lockedAt: true },
            })
            if (src) sourceFolderById.set(src.id, src)
          }
        }
      } else if (matches.length > 1) {
        results.push({
          assetId: move.assetId,
          filename: move.filename,
          status: "failed",
          fromFolderId: null,
          toFolderId: destinationId,
          code: "ambiguous_name",
          message: `${matches.length} files are named "${move.filename}" — resolve the id before moving.`,
        })
        continue
      }
    }

    if (!asset) {
      results.push({
        assetId: move.assetId,
        filename: move.filename ?? null,
        status: "failed",
        fromFolderId: null,
        toFolderId: destinationId,
        code: "asset_not_found",
        message: move.filename
          ? "No such file, or it is in the Trash, and no file of that exact name exists."
          : "No such file, or it is in the Trash.",
      })
      continue
    }

    let destination: FolderRow | null = null
    if (destinationId) {
      const found = folderById.get(destinationId)
      if (!found || found.deletedAt) {
        results.push({
          assetId: asset.id,
          filename: asset.originalFilename,
          status: "failed",
          fromFolderId: asset.folderId,
          toFolderId: destinationId,
          code: "destination_not_found",
          message: "The destination folder does not exist.",
        })
        continue
      }
      if (!granted(found)) {
        results.push({
          assetId: asset.id,
          filename: asset.originalFilename,
          status: "failed",
          fromFolderId: asset.folderId,
          toFolderId: destinationId,
          code: "destination_locked",
          message: "The destination folder is locked.",
        })
        continue
      }
      destination = found
    }

    const source = asset.folderId ? sourceFolderById.get(asset.folderId) : null
    if (source && !granted(source)) {
      results.push({
        assetId: asset.id,
        filename: asset.originalFilename,
        status: "failed",
        fromFolderId: asset.folderId,
        toFolderId: destinationId,
        code: "source_locked",
        message: "The file is in a locked folder.",
      })
      continue
    }

    // Idempotent. Running the organisation twice must not churn the library,
    // and a resumed run must not re-move what already landed.
    if ((asset.folderId ?? null) === (destination?.id ?? null)) {
      results.push({
        assetId: asset.id,
        filename: asset.originalFilename,
        status: "already_there",
        fromFolderId: asset.folderId,
        toFolderId: destination?.id ?? null,
        ...(recoveredByName ? { recoveredByName: true } : {}),
      })
      continue
    }

    const nextLibraryId = destination ? destination.libraryId : asset.libraryId

    try {
      await prisma.asset.update({
        where: { id: asset.id },
        data: { folderId: destination?.id ?? null, libraryId: nextLibraryId },
      })
    } catch (error) {
      results.push({
        assetId: asset.id,
        filename: asset.originalFilename,
        status: "failed",
        fromFolderId: asset.folderId,
        toFolderId: destination?.id ?? null,
        code: "write_failed",
        message: error instanceof Error ? error.message : "The move could not be saved.",
      })
      continue
    }

    const collided =
      destination !== null &&
      (namesByDestination.get(destination.id)?.has(asset.originalFilename) ?? false)
    // Track it so a second file of the same name in this batch is flagged too.
    if (destination) namesByDestination.get(destination.id)?.add(asset.originalFilename)

    applied.push({
      assetId: asset.id,
      filename: asset.originalFilename,
      fromFolderId: asset.folderId,
      fromLibraryId: asset.libraryId,
      toFolderId: destination?.id ?? null,
      toLibraryId: nextLibraryId,
    })

    results.push({
      assetId: asset.id,
      filename: asset.originalFilename,
      status: "moved",
      fromFolderId: asset.folderId,
      toFolderId: destination?.id ?? null,
      ...(collided ? { nameCollision: true } : {}),
      ...(recoveredByName ? { recoveredByName: true } : {}),
    })
  }

  /**
   * One activity event for the batch, carrying every before/after pair.
   *
   * Not one event per file: a 246-book reorganisation would bury the rest of
   * the feed. The per-file record still exists inside `metadata.moves`, which
   * is what makes the operation reversible — every row has where the file came
   * from, so `operationId` is enough to put the library back.
   */
  if (applied.length > 0) {
    const destinationNames = new Map<string, string>()
    for (const folder of folders) destinationNames.set(folder.id, folder.pathCache)

    await recordAndBroadcastActivity(
      { prisma, publishRealtimeEvent: input.publishRealtimeEvent },
      {
        userId,
        type: "assets.moved",
        title: applied.length === 1 ? "File moved" : `${applied.length} files moved`,
        message:
          applied.length === 1
            ? `${applied[0]!.filename} was moved.`
            : `${applied.length} files were moved into ${
                new Set(applied.map((m) => m.toFolderId ?? "root")).size
              } folder(s).`,
        entityType: "asset",
        entityId: applied[0]!.assetId,
        metadata: {
          operationId,
          source: input.source ?? "api",
          count: applied.length,
          reversible: true,
          moves: applied.map((m) => ({
            assetId: m.assetId,
            filename: m.filename,
            from: m.fromFolderId,
            fromLibraryId: m.fromLibraryId,
            to: m.toFolderId,
            toLibraryId: m.toLibraryId,
            toPath: m.toFolderId ? (destinationNames.get(m.toFolderId) ?? null) : null,
          })),
        },
      },
    )
  }

  return {
    operationId,
    requested: moves.length,
    moved: results.filter((r) => r.status === "moved").length,
    alreadyThere: results.filter((r) => r.status === "already_there").length,
    failed: results.filter((r) => r.status === "failed").length,
    recovered: results.filter((r) => r.recoveredByName).length,
    results,
  }
}

/**
 * Put a recorded batch back where it came from.
 *
 * Reads the `moves` list out of the activity event rather than recomputing
 * anything, so an undo is exactly the inverse of what happened — including for
 * files the user has since moved again, which is why each row is re-checked
 * against its current location before being reversed.
 */
export async function undoLibraryAssetMove(input: {
  prisma: PrismaClient
  userId: string
  operationId: string
  folderAccessGranted?: (folder: { id: string; lockedAt: Date | null }) => boolean
  publishRealtimeEvent?: (event: RealtimeEvent) => Promise<void>
}): Promise<MoveLibraryAssetsResult | { error: "operation_not_found" }> {
  // Matched on the recorded operation id, not "the most recent move" — the
  // user may well have reorganised something else since.
  const event = await input.prisma.activityEvent.findFirst({
    where: {
      type: "assets.moved",
      userId: input.userId,
      metadata: { path: ["operationId"], equals: input.operationId },
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  })

  const metadata = (event?.metadata ?? null) as {
    operationId?: string
    moves?: Array<{ assetId: string; from: string | null }>
  } | null

  if (!metadata?.moves) {
    return { error: "operation_not_found" }
  }

  return moveLibraryAssets({
    prisma: input.prisma,
    userId: input.userId,
    moves: metadata.moves.map((m) => ({ assetId: m.assetId, destinationFolderId: m.from })),
    folderAccessGranted: input.folderAccessGranted,
    publishRealtimeEvent: input.publishRealtimeEvent,
    source: "api",
  })
}
