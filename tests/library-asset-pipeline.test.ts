import { describe, expect, it } from "vitest"

import type { AssetSummary } from "@/lib/types/models"
import {
  SOURCE_ALL,
  SOURCE_MANUAL,
  collectSourceFilterOptions,
  filesSourceHref,
  filterAssetsBySource,
  pipelineLibraryAssets,
} from "@/lib/utils/library-asset-pipeline"

/**
 * The All Files source filter after Computer Backup was removed.
 *
 * The dropdown used to grow a "Computer backups" group and one entry per paired
 * computer, and selecting one switched the page into a filesystem browser.
 * None of that exists now: every asset in Arciin arrives through a manual
 * upload, so the only distinction left is "all" versus "manual", and the filter
 * never removes anything.
 */

function asset(
  partial: Partial<AssetSummary> & Pick<AssetSummary, "id" | "originalFilename" | "mediaType">,
): AssetSummary {
  return {
    libraryId: "lib",
    storageObjectId: "obj",
    ownerId: "user",
    filename: partial.originalFilename,
    mimeType: "application/octet-stream",
    extension: "bin",
    sizeBytes: 1,
    checksumSha256: "abc",
    status: "READY",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  }
}

const photo = asset({ id: "photo", originalFilename: "photo.jpg", mediaType: "IMAGE" })
const clip = asset({ id: "clip", originalFilename: "clip.mp4", mediaType: "VIDEO" })
const assets = [photo, clip]

describe("All Files source filter", () => {
  it("offers only All sources and Manual uploads", () => {
    expect(collectSourceFilterOptions(assets)).toEqual([
      { value: SOURCE_ALL, label: "All sources" },
      { value: SOURCE_MANUAL, label: "Manual uploads", group: "Manual uploads" },
    ])
  })

  it("offers the same two with no assets at all", () => {
    expect(collectSourceFilterOptions([])).toHaveLength(2)
  })

  it("never advertises a computer", () => {
    const labels = collectSourceFilterOptions(assets).map((option) => option.label)
    expect(labels.join(" ")).not.toMatch(/computer/i)
  })
})

describe("filtering by source", () => {
  it.each([SOURCE_ALL, SOURCE_MANUAL])("keeps every asset for %s", (source) => {
    expect(filterAssetsBySource(assets, source).map((a) => a.id)).toEqual(["photo", "clip"])
  })

  it("ignores an unknown source id rather than hiding everything", () => {
    // Stale bookmarks still carry ?source=computer:dev-desktop.
    expect(filterAssetsBySource(assets, "computer:dev-desktop").map((a) => a.id)).toEqual([
      "photo",
      "clip",
    ])
  })
})

describe("kind filtering still applies", () => {
  it("narrows to images without touching the source filter", () => {
    expect(
      pipelineLibraryAssets(assets, { kindFilter: "IMAGE", sourceFilter: SOURCE_ALL }).map(
        (a) => a.id,
      ),
    ).toEqual(["photo"])
  })
})

describe("All Files links", () => {
  it("omits the query string for the default source", () => {
    expect(filesSourceHref(SOURCE_ALL)).toBe("/files")
  })

  it("carries a non-default source", () => {
    expect(filesSourceHref(SOURCE_MANUAL)).toBe("/files?source=manual")
  })
})
