import { describe, expect, it } from "vitest"

import {
  ASSET_PAGE_SIZE_DEFAULT,
  ASSET_PAGE_SIZE_MAX,
  buildAssetPage,
  buildCursorWhere,
  clampPageSize,
  decodeAssetCursor,
  encodeAssetCursor,
} from "../apps/api/src/services/libraries/asset-pagination"

describe("asset cursors", () => {
  it("round-trips", () => {
    const cursor = { createdAt: new Date("2026-08-04T10:20:30.456Z"), id: "cma123" }
    const decoded = decodeAssetCursor(encodeAssetCursor(cursor))

    expect(decoded?.id).toBe(cursor.id)
    expect(decoded?.createdAt.toISOString()).toBe(cursor.createdAt.toISOString())
  })

  it("survives ids containing the separator character", () => {
    const cursor = { createdAt: new Date("2026-08-04T00:00:00.000Z"), id: "weird|id|value" }
    // Decoding splits on the FIRST separator, so the timestamp stays intact.
    expect(decodeAssetCursor(encodeAssetCursor(cursor))?.id).toBe("weird|id|value")
  })

  it("treats malformed input as no cursor rather than throwing", () => {
    for (const bad of ["", "!!!!", "bm90LWEtY3Vyc29y", undefined, null]) {
      expect(decodeAssetCursor(bad)).toBeNull()
    }
  })
})

describe("buildCursorWhere", () => {
  it("returns null without a cursor, so the first page is unfiltered", () => {
    expect(buildCursorWhere(null)).toBeNull()
  })

  it("matches strictly-older rows and same-timestamp ties by id", () => {
    const createdAt = new Date("2026-08-04T00:00:00.000Z")
    const where = buildCursorWhere({ createdAt, id: "id-500" })

    // Both branches are required: without the second, a batch written in one
    // millisecond would either repeat or lose rows at the page boundary.
    expect(where).toEqual({
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: "id-500" } },
      ],
    })
  })
})

describe("clampPageSize", () => {
  it("defaults when unset or nonsensical", () => {
    for (const bad of [undefined, 0, -5, Number.NaN]) {
      expect(clampPageSize(bad as number | undefined)).toBe(ASSET_PAGE_SIZE_DEFAULT)
    }
  })

  it("caps at the maximum so one request cannot pull the whole library", () => {
    expect(clampPageSize(100_000)).toBe(ASSET_PAGE_SIZE_MAX)
    expect(clampPageSize(25)).toBe(25)
  })
})

describe("buildAssetPage", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `id-${index}`,
      createdAt: new Date(`2026-08-0${(index % 8) + 1}T00:00:00.000Z`),
    }))

  it("drops the over-fetched probe row and reports more", () => {
    const page = buildAssetPage(rows(11), 10)

    expect(page.items).toHaveLength(10)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).not.toBeNull()
  })

  it("reports the end of the list when the probe row is absent", () => {
    const page = buildAssetPage(rows(7), 10)

    expect(page.items).toHaveLength(7)
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it("handles an empty result", () => {
    const page = buildAssetPage([], 10)

    expect(page.items).toEqual([])
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it("anchors the next cursor on the last returned row, not the probe row", () => {
    const all = rows(11)
    const page = buildAssetPage(all, 10)
    const decoded = decodeAssetCursor(page.nextCursor)

    // Anchoring on the probe row would skip it on the following page.
    expect(decoded?.id).toBe(all[9].id)
  })
})
