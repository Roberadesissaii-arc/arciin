import type { Prisma } from "@prisma/client"

import { codeExtensions } from "@arciin/shared"

/**
 * One definition of "an asset the user can actually find", shared by the
 * sidebar count and the asset list.
 *
 * These used to disagree: the sidebar counted every non-deleted asset in a
 * library while the library page asked for root-level assets of one media
 * type, so "Videos 6" could open on an empty page. Both now build their query
 * here, which is what keeps the number and the list in step.
 */

export type AssetScope =
  /** Everything in the library, folders included. Matches the sidebar count. */
  | { kind: "library"; libraryId: string }
  /** Only assets sitting directly at the library root. */
  | { kind: "libraryRoot"; libraryId: string }
  /** Inside one specific folder. */
  | { kind: "folder"; folderId: string }
  /** Across every library (All Files). */
  | { kind: "all" }

export type VisibleAssetQueryInput = {
  scope: AssetScope
  /**
   * Folders flagged `hideFromAllFiles`, plus their descendants. Excluded from
   * recursive views and from the count so the count matches what "All files"
   * shows; opening such a folder directly still lists its contents.
   */
  hiddenFolderIds?: string[]
  mediaType?: string
  search?: string
  /** Cross-library groupings that are not their own media type. */
  category?: "code" | "applications"
  /** Keyset condition from `buildCursorWhere`, when paginating. */
  cursor?: Prisma.AssetWhereInput | null
}

/**
 * Build the Prisma `where` for a visible-asset query.
 *
 * Pure, so the rules can be asserted in unit tests without a database.
 *
 * Invariants:
 * - soft-deleted assets are never returned;
 * - assets whose folder is soft-deleted are never returned (the folder is gone
 *   from every listing, so its contents are unreachable and must not be
 *   counted as visible);
 * - `hiddenFolderIds` applies to recursive scopes only, never when the caller
 *   asked for one specific folder.
 */
export function buildVisibleAssetWhere(
  input: VisibleAssetQueryInput,
): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = []

  switch (input.scope.kind) {
    case "library":
      and.push({ libraryId: input.scope.libraryId })
      break
    case "libraryRoot":
      and.push({ libraryId: input.scope.libraryId, folderId: null })
      break
    case "folder":
      and.push({ folderId: input.scope.folderId })
      break
    case "all":
      break
  }

  // An asset inside a deleted folder cannot be reached from any listing.
  // Expressed as a relation filter rather than an id list so it stays correct
  // however many folders have been deleted.
  if (input.scope.kind !== "folder") {
    and.push({
      OR: [{ folderId: null }, { folder: { is: { deletedAt: null } } }],
    })
  }

  if (input.scope.kind !== "folder" && input.hiddenFolderIds?.length) {
    and.push({
      OR: [{ folderId: null }, { folderId: { notIn: input.hiddenFolderIds } }],
    })
  }

  if (input.mediaType) {
    and.push({ mediaType: input.mediaType as Prisma.AssetWhereInput["mediaType"] })
  }

  if (input.search) {
    and.push({
      OR: [
        { originalFilename: { contains: input.search, mode: "insensitive" } },
        { title: { contains: input.search, mode: "insensitive" } },
      ],
    })
  }

  // Category runs in the database. It used to over-fetch a fixed window and
  // filter in JS, so a code file older than that window was simply invisible —
  // and it made cursor pagination impossible to reason about.
  if (input.category === "code") {
    and.push({
      OR: [
        { mediaType: "CODE" },
        { extension: { in: [...codeExtensions] } },
        // Extension-less names that `isCodeFilename` also treats as code.
        { originalFilename: { equals: "Dockerfile", mode: "insensitive" } },
        { originalFilename: { equals: "Makefile", mode: "insensitive" } },
        { originalFilename: { startsWith: ".env" } },
      ],
    })
  }

  if (input.category === "applications") {
    and.push({ mediaType: "APPLICATION" })
  }

  if (input.cursor) {
    and.push(input.cursor)
  }

  return { deletedAt: null, AND: and }
}
