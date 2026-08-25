import type { PrismaClient } from "@prisma/client"
import { TRASH_RETENTION_DAYS } from "@arciin/shared"

/**
 * Moving library files to Trash on the user's behalf.
 *
 * The assistant could already find duplicates and prove they were duplicates —
 * it opened all seven Atlantis PDFs and compared page counts and prologues —
 * and then had to end with "I don't have a tool to delete files". Asking a
 * question, being told yes, and answering that you cannot act is the worst
 * shape a capability can have.
 *
 * Two deliberate differences from `moveLibraryAssets`:
 *
 *   1. `filename` is **required** and **verified**, not used for recovery. A
 *      move recovered from a wrong id is harmless; a delete "recovered" onto
 *      the wrong file destroys something nobody named. A mismatch fails that
 *      one file and leaves it alone.
 *   2. Nothing leaves the disk. This is the same soft delete the Trash UI
 *      performs, so every deletion the assistant makes is reversible from
 *      /trash for the full retention window.
 *
 * Mirror clean-up and the activity/realtime announcement are injected rather
 * than imported, so this module keeps no Fastify dependency and the decision
 * it makes can be tested without a server — the same reasoning the chat tool
 * context uses for `deliverAsset`.
 */

/** Deliberately far below the move cap: deletion should be deliberate, not bulk. */
export const MAX_DELETES_PER_BATCH = 50

export type DeleteRequestItem = {
  assetId: string
  /** Exact filename, verified against the stored asset before anything happens. */
  filename: string
}

export type DeleteFailureCode = "asset_not_found" | "name_mismatch" | "already_deleted"

export type DeleteResultItem = {
  assetId: string
  filename: string
  status: "deleted" | "failed"
  code?: DeleteFailureCode
  message?: string
  /** What the id actually pointed at, when the name did not match. */
  actualFilename?: string
}

export type DeleteLibraryAssetsResult = {
  deleted: number
  failed: number
  retentionDays: number
  results: DeleteResultItem[]
}

export type DeleteLibraryAssetsInput = {
  prisma: PrismaClient
  userId: string
  items: DeleteRequestItem[]
  /** Drops Plex/Jellyfin mirrors before the row changes. */
  clearMirrors?: (assetId: string) => Promise<void>
  /** Records activity and broadcasts, so the UI reacts as it does to a manual delete. */
  onDeleted?: (deleted: {
    assetId: string
    libraryId: string
    filename: string
    retentionDays: number
  }) => Promise<void>
}

/** Filenames differ by case and stray whitespace far more often than by content. */
function sameFilename(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export async function deleteLibraryAssets(
  input: DeleteLibraryAssetsInput,
): Promise<DeleteLibraryAssetsResult> {
  const results: DeleteResultItem[] = []

  for (const item of input.items) {
    const asset = await input.prisma.asset.findFirst({
      where: { id: item.assetId },
      select: {
        id: true,
        originalFilename: true,
        libraryId: true,
        deletedAt: true,
      },
    })

    if (!asset) {
      results.push({
        assetId: item.assetId,
        filename: item.filename,
        status: "failed",
        code: "asset_not_found",
        message: "No file with that id. Look it up with find_library_file — never retype an id.",
      })
      continue
    }

    if (asset.deletedAt) {
      results.push({
        assetId: item.assetId,
        filename: asset.originalFilename,
        status: "failed",
        code: "already_deleted",
        message: "That file is already in Trash.",
      })
      continue
    }

    // The guard that makes this tool safe to hand to a model.
    if (!sameFilename(asset.originalFilename, item.filename)) {
      results.push({
        assetId: item.assetId,
        filename: item.filename,
        status: "failed",
        code: "name_mismatch",
        actualFilename: asset.originalFilename,
        message:
          "That id belongs to a different file, so nothing was deleted. Re-read the listing and use the id that really goes with this name.",
      })
      continue
    }

    // Mirrors are rebuilt from the library, so they go before the row changes.
    await input.clearMirrors?.(asset.id).catch(() => {})

    await input.prisma.asset.update({
      where: { id: asset.id },
      data: {
        status: "DELETED",
        deletedAt: new Date(),
        libraryMirrorPath: null,
      },
    })

    await input.onDeleted?.({
      assetId: asset.id,
      libraryId: asset.libraryId,
      filename: asset.originalFilename,
      retentionDays: TRASH_RETENTION_DAYS,
    })

    results.push({
      assetId: asset.id,
      filename: asset.originalFilename,
      status: "deleted",
    })
  }

  return {
    deleted: results.filter((r) => r.status === "deleted").length,
    failed: results.filter((r) => r.status === "failed").length,
    retentionDays: TRASH_RETENTION_DAYS,
    results,
  }
}
