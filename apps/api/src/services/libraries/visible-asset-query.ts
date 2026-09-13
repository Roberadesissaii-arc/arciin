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
  /**
   * Kind library plus computer-backup files of the same media type.
   * Used so Images/Videos/Music/Documents act as smart views.
   */
  | {
      kind: "libraryView"
      libraryId: string
      mediaType: "VIDEO" | "IMAGE" | "AUDIO" | "DOCUMENT"
      computerLibraryIds: string[]
      rootOnly?: boolean
    }

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
  category?: "code" | "applications" | "other"
  /**
   * Libraries whose contents are deliberately absent from a cross-library
   * listing — in practice Inbox, which is a holding area rather than a place
   * files live. Never applied to a count, and never when the caller asked for
   * one of these libraries by name.
   */
  excludeLibraryIds?: string[]
  /**
   * User-archive filter. Default `exclude` keeps Archives out of Videos /
   * Images / All Files. `only` is the Archives chip. `include` is rare
   * (admin / search).
   */
  archived?: "exclude" | "only" | "include"
  /** Keyset condition from `buildCursorWhere`, when paginating. */
  cursor?: Prisma.AssetWhereInput | null
  /**
   * When set, computer-backup assets belonging to other users are hidden.
   * OWNER/ADMIN pass null to see every computer file.
   */
  restrictComputerOwnerId?: string | null
  computerLibraryIds?: string[]
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
    case "libraryView":
      and.push({
        OR: [
          input.scope.rootOnly
            ? { libraryId: input.scope.libraryId, folderId: null }
            : { libraryId: input.scope.libraryId },
          {
            libraryId: { in: input.scope.computerLibraryIds },
            mediaType: input.scope.mediaType,
          },
        ],
      })
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
    /**
     * A search box is not a pattern language.
     *
     * Prisma's `contains` becomes SQL LIKE, so `%` and `_` kept their wildcard
     * meaning: searching for a literal "%" matched 264 of 266 assets. Escaping
     * them (and the escape character itself, first) makes the box mean what a
     * reader thinks it means. This is not an injection — values are still
     * parameterised — it is the wrong answer.
     */
    const literal = input.search.replace(/[\\%_]/g, (ch) => `\\${ch}`)
    and.push({
      OR: [
        { originalFilename: { contains: literal, mode: "insensitive" } },
        { title: { contains: literal, mode: "insensitive" } },
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

  // All Files → Other: unclassified, installers, code, and zip containers.
  if (input.category === "other") {
    and.push({
      mediaType: { in: ["OTHER", "APPLICATION", "CODE", "ARCHIVE"] },
    })
  }

  // Inbox is where a file waits to be filed, not a library of its own. Its
  // contents are unclassified by definition — an .msi, a .zip, a .json — so
  // they have no thumbnail and nothing to preview, and in a grid of media they
  // are grey tiles taking slots. "Recent uploads" reads the same list as All
  // Files, so one upload put them on the dashboard and the phone too.
  //
  // Scoped by library rather than by media type: the first attempt excluded
  // APPLICATION assets, which missed the .zip and the .json sitting beside them
  // and — because it was keyed off the "all" scope that the sidebar count also
  // uses — quietly subtracted them from Inbox's own badge.
  if (input.excludeLibraryIds?.length) {
    and.push({ libraryId: { notIn: input.excludeLibraryIds } })
  }

  const archivedMode = input.archived ?? "exclude"
  if (archivedMode === "only") {
    and.push({ archivedAt: { not: null } })
  } else if (archivedMode === "exclude") {
    and.push({ archivedAt: null })
  }

  if (input.restrictComputerOwnerId && input.computerLibraryIds?.length) {
    and.push({
      OR: [
        { libraryId: { notIn: input.computerLibraryIds } },
        { ownerId: input.restrictComputerOwnerId },
      ],
    })
  }

  if (input.cursor) {
    and.push(input.cursor)
  }

  return { deletedAt: null, AND: and }
}
