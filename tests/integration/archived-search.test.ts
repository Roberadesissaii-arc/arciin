import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildVisibleAssetWhere } from "../../apps/api/src/services/libraries/visible-asset-query"
import {
  createAsset,
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * All Files search finds archived files; browsing and counts do not.
 *
 * Walks one file through its whole life — active, archived, unarchived,
 * trashed, restored — and asks the same three questions the web client asks at
 * each step: does a search find it, is it marked archived, and does the active
 * count include it.
 */

let fixtures: Fixtures

beforeAll(async () => {
  await resetDatabase()
  fixtures = await seedBaseFixtures(await createTestStorageRoot())
})

afterAll(async () => {
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

const allScope = { kind: "all" as const }

async function search(term: string) {
  // What the client sends for an All Files search on the "All" chip.
  return prisma.asset.findMany({
    where: buildVisibleAssetWhere({ scope: allScope, search: term, archived: "include" }),
    select: { id: true, archivedAt: true },
  })
}

async function browse() {
  return prisma.asset.findMany({
    where: buildVisibleAssetWhere({ scope: allScope, archived: "exclude" }),
    select: { id: true },
  })
}

async function activeCount() {
  return prisma.asset.count({ where: buildVisibleAssetWhere({ scope: allScope }) })
}

describe("archived search lifecycle", () => {
  it("active → archived → unarchived → trashed → restored", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      mediaType: "DOCUMENT",
      originalFilename: "quarterly-menu-plan.pdf",
      extension: "pdf",
      mimeType: "application/pdf",
    })
    const baseline = await activeCount()

    // Active: found, not archived, counted.
    let found = await search("menu-plan")
    expect(found.map((a) => a.id)).toEqual([asset.id])
    expect(found[0]!.archivedAt).toBeNull()

    // Archived: still found by search and flagged; gone from browsing and counts.
    await prisma.asset.update({ where: { id: asset.id }, data: { archivedAt: new Date() } })
    found = await search("menu-plan")
    expect(found.map((a) => a.id)).toEqual([asset.id])
    expect(found[0]!.archivedAt).not.toBeNull()
    expect((await browse()).map((a) => a.id)).not.toContain(asset.id)
    expect(await activeCount()).toBe(baseline - 1)

    // Unarchived: active again.
    await prisma.asset.update({ where: { id: asset.id }, data: { archivedAt: null } })
    found = await search("menu-plan")
    expect(found[0]!.archivedAt).toBeNull()
    expect(await activeCount()).toBe(baseline)

    // Trashed: search never reaches Trash, archived or not.
    await prisma.asset.update({
      where: { id: asset.id },
      data: { deletedAt: new Date(), archivedAt: new Date() },
    })
    expect(await search("menu-plan")).toEqual([])
    await prisma.asset.update({ where: { id: asset.id }, data: { archivedAt: null } })
    expect(await search("menu-plan")).toEqual([])
    expect(await activeCount()).toBe(baseline - 1)

    // Restored: found again.
    await prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: null } })
    expect((await search("menu-plan")).map((a) => a.id)).toEqual([asset.id])
    expect(await activeCount()).toBe(baseline)
  })
})
