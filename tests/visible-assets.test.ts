import { describe, expect, it } from "vitest"

import { buildVisibleAssetWhere } from "../apps/api/src/services/libraries/visible-asset-query"

/**
 * Part 3 — the sidebar count and the library page must describe the same set.
 *
 * They previously disagreed three ways: the count included every non-deleted
 * asset in the library while the page asked for root-level assets of a single
 * media type, and neither excluded assets stranded inside soft-deleted folders.
 * "Videos 6" could therefore open onto an empty page.
 */

/** Flatten the AND array so assertions read against one merged object. */
function clauses(where: ReturnType<typeof buildVisibleAssetWhere>) {
  return (where.AND ?? []) as Array<Record<string, unknown>>
}

function hasClause(
  where: ReturnType<typeof buildVisibleAssetWhere>,
  predicate: (clause: Record<string, unknown>) => boolean,
) {
  return clauses(where).some(predicate)
}

const excludesDeletedFolders = (clause: Record<string, unknown>) =>
  JSON.stringify(clause) === JSON.stringify({
    OR: [{ folderId: null }, { folder: { is: { deletedAt: null } } }],
  })

describe("buildVisibleAssetWhere", () => {
  it("always excludes soft-deleted assets", () => {
    for (const scope of [
      { kind: "all" } as const,
      { kind: "library", libraryId: "lib-1" } as const,
      { kind: "libraryRoot", libraryId: "lib-1" } as const,
      { kind: "folder", folderId: "folder-1" } as const,
    ]) {
      expect(buildVisibleAssetWhere({ scope }).deletedAt).toBeNull()
    }
  })

  it("counts a library recursively — folders included", () => {
    const where = buildVisibleAssetWhere({
      scope: { kind: "library", libraryId: "lib-1" },
    })

    expect(hasClause(where, (c) => c.libraryId === "lib-1")).toBe(true)
    // No folderId constraint: nested assets are in scope, which is what makes
    // the sidebar count reachable from the All files view.
    expect(hasClause(where, (c) => "folderId" in c && c.folderId === null)).toBe(false)
  })

  it("narrows to the library root only when asked", () => {
    const where = buildVisibleAssetWhere({
      scope: { kind: "libraryRoot", libraryId: "lib-1" },
    })

    expect(hasClause(where, (c) => c.libraryId === "lib-1" && c.folderId === null)).toBe(true)
  })

  it("excludes assets inside soft-deleted folders from every recursive scope", () => {
    for (const scope of [
      { kind: "all" } as const,
      { kind: "library", libraryId: "lib-1" } as const,
      { kind: "libraryRoot", libraryId: "lib-1" } as const,
    ]) {
      expect(hasClause(buildVisibleAssetWhere({ scope }), excludesDeletedFolders)).toBe(true)
    }
  })

  it("does not second-guess an explicit folder request", () => {
    // Opening a folder by id lists its contents; the deleted-folder and hidden
    // rules are about what surfaces in recursive listings.
    const where = buildVisibleAssetWhere({
      scope: { kind: "folder", folderId: "folder-1" },
      hiddenFolderIds: ["folder-1"],
    })

    expect(hasClause(where, (c) => c.folderId === "folder-1")).toBe(true)
    expect(hasClause(where, excludesDeletedFolders)).toBe(false)
    expect(hasClause(where, (c) => "OR" in c && JSON.stringify(c).includes("notIn"))).toBe(
      false,
    )
  })

  it("excludes hidden folders from recursive scopes", () => {
    const where = buildVisibleAssetWhere({
      scope: { kind: "library", libraryId: "lib-1" },
      hiddenFolderIds: ["hidden-1", "hidden-2"],
    })

    expect(
      hasClause(where, (c) =>
        JSON.stringify(c) ===
        JSON.stringify({
          OR: [{ folderId: null }, { folderId: { notIn: ["hidden-1", "hidden-2"] } }],
        }),
      ),
    ).toBe(true)
  })

  it("adds no hidden-folder clause when there is nothing hidden", () => {
    const where = buildVisibleAssetWhere({
      scope: { kind: "library", libraryId: "lib-1" },
      hiddenFolderIds: [],
    })

    expect(hasClause(where, (c) => JSON.stringify(c).includes("notIn"))).toBe(false)
  })

  it("applies mediaType and search only when supplied", () => {
    const bare = buildVisibleAssetWhere({ scope: { kind: "all" } })
    expect(hasClause(bare, (c) => "mediaType" in c)).toBe(false)
    expect(hasClause(bare, (c) => JSON.stringify(c).includes("originalFilename"))).toBe(false)

    const filtered = buildVisibleAssetWhere({
      scope: { kind: "all" },
      mediaType: "VIDEO",
      search: "holiday",
    })
    expect(hasClause(filtered, (c) => c.mediaType === "VIDEO")).toBe(true)
    expect(hasClause(filtered, (c) => JSON.stringify(c).includes("holiday"))).toBe(true)
  })

  it("uses identical rules for the count and the All files list", () => {
    // The count is scope "all" grouped by library; the library page is scope
    // "library". Same visibility clauses, differing only by the library filter,
    // is what keeps the sidebar number and the listing in agreement.
    const countWhere = buildVisibleAssetWhere({
      scope: { kind: "all" },
      hiddenFolderIds: ["hidden-1"],
    })
    const listWhere = buildVisibleAssetWhere({
      scope: { kind: "library", libraryId: "lib-1" },
      hiddenFolderIds: ["hidden-1"],
    })

    const visibilityOnly = (where: ReturnType<typeof buildVisibleAssetWhere>) =>
      clauses(where).filter((c) => !("libraryId" in c))

    expect(visibilityOnly(listWhere)).toEqual(visibilityOnly(countWhere))
  })

  it("treats kind libraries as smart views over computer-backup files", () => {
    const where = buildVisibleAssetWhere({
      scope: {
        kind: "libraryView",
        libraryId: "images",
        mediaType: "IMAGE",
        computerLibraryIds: ["computers"],
      },
    })
    expect(hasClause(where, (c) => JSON.stringify(c).includes("computers"))).toBe(true)
    expect(hasClause(where, (c) => JSON.stringify(c).includes("IMAGE"))).toBe(true)
    expect(where.deletedAt).toBeNull()
  })

  it("keeps Documents on DOCUMENT files only, even inside that library", () => {
    const where = buildVisibleAssetWhere({
      scope: {
        kind: "libraryView",
        libraryId: "documents",
        mediaType: "DOCUMENT",
        computerLibraryIds: ["computers"],
      },
    })
    expect(hasClause(where, (c) => c.mediaType === "DOCUMENT")).toBe(true)
    expect(hasClause(where, (c) => JSON.stringify(c).includes("documents"))).toBe(true)
  })

  it("returns an empty-library count of zero rather than a broken query", () => {
    const where = buildVisibleAssetWhere({
      scope: { kind: "library", libraryId: "empty-lib" },
    })

    // Nothing here can match every row by accident; the library filter is present.
    expect(hasClause(where, (c) => c.libraryId === "empty-lib")).toBe(true)
    expect(where.deletedAt).toBeNull()
  })
})
