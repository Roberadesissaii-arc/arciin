import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildVisibleAssetWhere } from "../../apps/api/src/services/libraries/visible-asset-query"
import {
  ASSET_PAGE_ORDER_BY,
  buildAssetPage,
  buildCursorWhere,
  decodeAssetCursor,
} from "../../apps/api/src/services/libraries/asset-pagination"
import {
  createAsset,
  createFolder,
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * These run the visibility and pagination query builders against real
 * PostgreSQL. Unit tests can only assert the shape of the `where` object;
 * only a real database proves the relation filter and the keyset comparison
 * actually select the right rows.
 */

let fixtures: Fixtures

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
})

afterAll(async () => {
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

/** Page through every row using the real cursor logic. */
async function readAllPages(
  where: Parameters<typeof prisma.asset.findMany>[0] extends undefined
    ? never
    : Record<string, unknown>,
  pageSize: number,
) {
  const seen: string[] = []
  let cursor: string | undefined

  for (let guard = 0; guard < 200; guard += 1) {
    const rows = await prisma.asset.findMany({
      where: {
        ...where,
        AND: [
          ...((where.AND as unknown[]) ?? []),
          ...(buildCursorWhere(decodeAssetCursor(cursor)) ? [buildCursorWhere(decodeAssetCursor(cursor))!] : []),
        ],
      } as never,
      orderBy: ASSET_PAGE_ORDER_BY,
      take: pageSize + 1,
    })

    const page = buildAssetPage(rows, pageSize)
    seen.push(...page.items.map((row) => row.id))
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }

  return seen
}

describe("visible asset queries against PostgreSQL", () => {
  it("excludes soft-deleted assets", async () => {
    const live = await createAsset(fixtures, { librarySlug: "images", mediaType: "IMAGE" })
    await createAsset(fixtures, {
      librarySlug: "images",
      mediaType: "IMAGE",
      deletedAt: new Date(),
    })

    const rows = await prisma.asset.findMany({
      where: buildVisibleAssetWhere({ scope: { kind: "library", libraryId: fixtures.libraries.images.id } }),
    })

    expect(rows.map((r) => r.id)).toContain(live.id)
    expect(rows).toHaveLength(1)
  })

  it("excludes assets stranded inside a soft-deleted folder", async () => {
    const deletedFolder = await createFolder(fixtures, {
      librarySlug: "videos",
      name: "Removed",
      deletedAt: new Date(),
    })
    const liveFolder = await createFolder(fixtures, { librarySlug: "videos", name: "Movies" })

    const reachable = await createAsset(fixtures, {
      librarySlug: "videos",
      folderId: liveFolder.id,
      mediaType: "VIDEO",
    })
    const stranded = await createAsset(fixtures, {
      librarySlug: "videos",
      folderId: deletedFolder.id,
      mediaType: "VIDEO",
    })

    const visible = await prisma.asset.findMany({
      where: buildVisibleAssetWhere({
        scope: { kind: "library", libraryId: fixtures.libraries.videos.id },
      }),
    })
    const ids = visible.map((r) => r.id)

    expect(ids).toContain(reachable.id)
    expect(ids).not.toContain(stranded.id)

    // Opening the deleted folder directly still lists it — the exclusion is
    // about recursive views, not an absolute ban.
    const inFolder = await prisma.asset.findMany({
      where: buildVisibleAssetWhere({ scope: { kind: "folder", folderId: deletedFolder.id } }),
    })
    expect(inFolder.map((r) => r.id)).toContain(stranded.id)
  })

  it("makes nested assets discoverable and root-only genuinely narrower", async () => {
    const folder = await createFolder(fixtures, { librarySlug: "documents", name: "Invoices" })
    const nested = await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: folder.id,
      mediaType: "DOCUMENT",
    })
    const atRoot = await createAsset(fixtures, {
      librarySlug: "documents",
      mediaType: "DOCUMENT",
    })

    const recursive = await prisma.asset.findMany({
      where: buildVisibleAssetWhere({
        scope: { kind: "library", libraryId: fixtures.libraries.documents.id },
      }),
    })
    expect(recursive.map((r) => r.id).sort()).toEqual([nested.id, atRoot.id].sort())

    const rootOnly = await prisma.asset.findMany({
      where: buildVisibleAssetWhere({
        scope: { kind: "libraryRoot", libraryId: fixtures.libraries.documents.id },
      }),
    })
    expect(rootOnly.map((r) => r.id)).toEqual([atRoot.id])
  })

  it("does not hide an asset whose media type contradicts its library", async () => {
    // The exact shape that used to be counted but unreachable.
    const imageInVideos = await createAsset(fixtures, {
      librarySlug: "videos",
      mediaType: "IMAGE",
      originalFilename: "screenshot.jpg",
    })

    const rows = await prisma.asset.findMany({
      where: buildVisibleAssetWhere({
        scope: { kind: "library", libraryId: fixtures.libraries.videos.id },
      }),
    })

    expect(rows.map((r) => r.id)).toContain(imageInVideos.id)
  })

  it("counts exactly what the listing returns", async () => {
    const filters = {
      scope: { kind: "library", libraryId: fixtures.libraries.videos.id },
    } as const

    const [count, rows] = await Promise.all([
      prisma.asset.count({ where: buildVisibleAssetWhere(filters) }),
      prisma.asset.findMany({ where: buildVisibleAssetWhere(filters) }),
    ])

    expect(count).toBe(rows.length)
  })

  it("reports zero for an empty library", async () => {
    const count = await prisma.asset.count({
      where: buildVisibleAssetWhere({
        scope: { kind: "library", libraryId: fixtures.libraries.inbox.id },
      }),
    })
    expect(count).toBe(0)
  })
})

describe("cursor pagination against PostgreSQL", () => {
  it("walks past 1,000 rows with no duplicates and no gaps", async () => {
    await resetDatabase()
    const root = await createTestStorageRoot()
    fixtures = await seedBaseFixtures(root)

    const TOTAL = 1_001
    const base = new Date("2026-08-01T00:00:00.000Z").getTime()

    // Deliberately give many rows an identical createdAt: a same-millisecond
    // batch upload is exactly where an offset or createdAt-only cursor breaks.
    const rows = Array.from({ length: TOTAL }, (_, index) => ({
      index,
      createdAt: new Date(base + Math.floor(index / 50) * 1000),
    }))

    for (const row of rows) {
      await createAsset(fixtures, {
        librarySlug: "images",
        mediaType: "IMAGE",
        createdAt: row.createdAt,
        originalFilename: `bulk-${row.index}.jpg`,
      })
    }

    const where = buildVisibleAssetWhere({
      scope: { kind: "library", libraryId: fixtures.libraries.images.id },
    }) as unknown as Record<string, unknown>

    const total = await prisma.asset.count({ where: where as never })
    expect(total).toBe(TOTAL)

    const seen = await readAllPages(where, 60)

    expect(seen).toHaveLength(TOTAL)
    expect(new Set(seen).size).toBe(TOTAL)
  })

  it("returns the same rows regardless of page size", async () => {
    const where = buildVisibleAssetWhere({
      scope: { kind: "library", libraryId: fixtures.libraries.images.id },
    }) as unknown as Record<string, unknown>

    const [small, large] = await Promise.all([readAllPages(where, 17), readAllPages(where, 200)])

    expect(small).toEqual(large)
  })

  it("applies search in the database across page boundaries", async () => {
    const where = buildVisibleAssetWhere({
      scope: { kind: "library", libraryId: fixtures.libraries.images.id },
      search: "bulk-1",
    }) as unknown as Record<string, unknown>

    const total = await prisma.asset.count({ where: where as never })
    const seen = await readAllPages(where, 10)

    // bulk-1, bulk-1x, bulk-1xx — whatever the count, paging must reach all of it.
    expect(total).toBeGreaterThan(10)
    expect(seen).toHaveLength(total)
    expect(new Set(seen).size).toBe(total)
  })
})
