import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { deleteLibraryAssets } from "../../apps/api/src/services/assets/delete-library-assets"
import { listTrashedAssets, restoreTrashedAsset } from "../../apps/api/src/services/assets/trash"
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
 * The clean-up the assistant offers, run against a real database.
 *
 * The unit tests pin the decision; this pins the consequence — that the two
 * duplicate rows really leave the library, the copy being kept really stays,
 * and everything deleted is really recoverable from Trash. A deletion tool
 * given to a model is only defensible if that last part is true.
 */

let fixtures: Fixtures
let storageRoot: string

beforeAll(async () => {
  storageRoot = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(storageRoot)
})

afterAll(async () => {
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.asset.deleteMany()
  await prisma.storageObject.deleteMany()
})

/** The three Atlantis World copies from the reported library. */
async function seedDuplicates() {
  const keep = await createAsset(fixtures, {
    librarySlug: "documents",
    mediaType: "DOCUMENT",
    originalFilename: "The Atlantis World (The Origin Mystery, Book 3) (Riddle, A.G.) (z-lib.org).pdf",
    extension: "pdf",
    mimeType: "application/pdf",
  })
  const dupeA = await createAsset(fixtures, {
    librarySlug: "documents",
    mediaType: "DOCUMENT",
    originalFilename: "The Atlantis World (A.G. Riddle) (z-lib.org).pdf",
    extension: "pdf",
    mimeType: "application/pdf",
  })
  const dupeB = await createAsset(fixtures, {
    librarySlug: "documents",
    mediaType: "DOCUMENT",
    originalFilename: "The Atlantis World (A.G. Riddle) (z-lib.org) (1).pdf",
    extension: "pdf",
    mimeType: "application/pdf",
  })
  return { keep, dupeA, dupeB }
}

const ownerId = () => fixtures.user.id

describe("deleting duplicates for real", () => {
  it("removes the two copies and leaves the third", async () => {
    const { keep, dupeA, dupeB } = await seedDuplicates()

    const result = await deleteLibraryAssets({
      prisma,
      userId: ownerId(),
      items: [
        { assetId: dupeA.id, filename: dupeA.originalFilename },
        { assetId: dupeB.id, filename: dupeB.originalFilename },
      ],
    })

    expect(result.deleted).toBe(2)
    expect(result.failed).toBe(0)

    const live = await prisma.asset.findMany({ where: { deletedAt: null } })
    expect(live.map((a) => a.id)).toEqual([keep.id])
  })

  it("puts them in Trash, where they can be restored", async () => {
    const { dupeA } = await seedDuplicates()

    await deleteLibraryAssets({
      prisma,
      userId: ownerId(),
      items: [{ assetId: dupeA.id, filename: dupeA.originalFilename }],
    })

    const trashed = await listTrashedAssets(prisma)
    expect(trashed.map((a) => a.id)).toContain(dupeA.id)

    await restoreTrashedAsset(prisma, dupeA.id)

    const restored = await prisma.asset.findUniqueOrThrow({ where: { id: dupeA.id } })
    expect(restored.deletedAt).toBeNull()
    expect(restored.status).not.toBe("DELETED")
  })

  it("leaves the bytes alone — a soft delete is not a purge", async () => {
    const { dupeA } = await seedDuplicates()
    const before = await prisma.asset.findUniqueOrThrow({
      where: { id: dupeA.id },
      include: { storageObject: true },
    })

    await deleteLibraryAssets({
      prisma,
      userId: ownerId(),
      items: [{ assetId: dupeA.id, filename: dupeA.originalFilename }],
    })

    const object = await prisma.storageObject.findUnique({
      where: { id: before.storageObjectId },
    })
    expect(object).not.toBeNull()
  })

  it("deletes nothing when an id carries the wrong name", async () => {
    const { keep, dupeA } = await seedDuplicates()

    const result = await deleteLibraryAssets({
      prisma,
      userId: ownerId(),
      // The kept book's id under a duplicate's name — the mistake that would
      // otherwise cost the user the copy they chose to keep.
      items: [{ assetId: keep.id, filename: dupeA.originalFilename }],
    })

    expect(result.deleted).toBe(0)
    expect(result.results[0]!.code).toBe("name_mismatch")

    const stillLive = await prisma.asset.findUniqueOrThrow({ where: { id: keep.id } })
    expect(stillLive.deletedAt).toBeNull()
  })

  it("completes the files it can and reports the ones it cannot", async () => {
    const { dupeA, dupeB } = await seedDuplicates()

    const result = await deleteLibraryAssets({
      prisma,
      userId: ownerId(),
      items: [
        { assetId: dupeA.id, filename: dupeA.originalFilename },
        { assetId: dupeB.id, filename: "A Book That Does Not Exist.pdf" },
      ],
    })

    expect(result.deleted).toBe(1)
    expect(result.failed).toBe(1)

    const survivor = await prisma.asset.findUniqueOrThrow({ where: { id: dupeB.id } })
    expect(survivor.deletedAt).toBeNull()
  })

  it("refuses a file already in Trash instead of deleting it twice", async () => {
    const { dupeA } = await seedDuplicates()
    const items = [{ assetId: dupeA.id, filename: dupeA.originalFilename }]

    await deleteLibraryAssets({ prisma, userId: ownerId(), items })
    const second = await deleteLibraryAssets({ prisma, userId: ownerId(), items })

    expect(second.deleted).toBe(0)
    expect(second.results[0]!.code).toBe("already_deleted")
  })
})
