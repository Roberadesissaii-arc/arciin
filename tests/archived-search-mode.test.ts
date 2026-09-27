import { describe, expect, it } from "vitest"

import {
  allFilesArchivedMode,
  filterAssetsByKind,
} from "../apps/web/lib/utils/library-asset-pipeline"
import type { AssetSummary } from "../apps/web/lib/types/models"

/**
 * The client half of archived search: what All Files asks the server for, and
 * what the kind filter then keeps. The server half is
 * tests/integration/archived-search.test.ts.
 */

describe("allFilesArchivedMode", () => {
  it("browsing hides archived", () => {
    expect(allFilesArchivedMode({ kindFilter: "all", search: "" })).toBe("exclude")
    expect(allFilesArchivedMode({ kindFilter: "all", search: "   " })).toBe("exclude")
    expect(allFilesArchivedMode({ kindFilter: "IMAGE", search: "" })).toBe("exclude")
  })

  it("searching includes archived", () => {
    expect(allFilesArchivedMode({ kindFilter: "all", search: "menu" })).toBe("include")
    expect(allFilesArchivedMode({ kindFilter: "IMAGE", search: "menu" })).toBe("include")
  })

  it("the Archives chip is archived only, searching or not", () => {
    expect(allFilesArchivedMode({ kindFilter: "ARCHIVE", search: "" })).toBe("only")
    expect(allFilesArchivedMode({ kindFilter: "ARCHIVE", search: "menu" })).toBe("only")
  })

  it("Other stays active-only", () => {
    expect(allFilesArchivedMode({ kindFilter: "OTHER", search: "menu" })).toBe("exclude")
  })
})

describe("filterAssetsByKind with archived search results", () => {
  const asset = (id: string, mediaType: string, archivedAt: string | null) =>
    ({ id, mediaType, archivedAt }) as unknown as AssetSummary
  const rows = [
    asset("active-img", "IMAGE", null),
    asset("archived-img", "IMAGE", "2026-01-01T00:00:00Z"),
    asset("archived-doc", "DOCUMENT", "2026-01-01T00:00:00Z"),
  ]
  const ids = (list: AssetSummary[]) => list.map((a) => a.id)

  it("keeps archived rows on the All chip only when asked", () => {
    expect(ids(filterAssetsByKind(rows, "all"))).toEqual(["active-img"])
    expect(ids(filterAssetsByKind(rows, "all", { includeArchived: true }))).toEqual([
      "active-img",
      "archived-img",
      "archived-doc",
    ])
  })

  it("matches archived rows by media type inside a kind chip", () => {
    expect(ids(filterAssetsByKind(rows, "IMAGE", { includeArchived: true }))).toEqual([
      "active-img",
      "archived-img",
    ])
  })

  it("the Archives chip is unchanged", () => {
    expect(ids(filterAssetsByKind(rows, "ARCHIVE"))).toEqual(["archived-img", "archived-doc"])
  })
})
