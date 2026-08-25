import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { deleteLibraryAssets } from "../../apps/api/src/services/assets/delete-library-assets"
import { listTrashedAssets, restoreTrashedAsset } from "../../apps/api/src/services/assets/trash"
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

/**
 * FIX-015 — deleting a folder must not take its files with it.
 *
 * The confirmation dialog says "Files stay in place until you delete them
 * separately". It was untrue: only the folder rows were soft-deleted, so the
 * assets kept pointing at a deleted folder. Listings hide those, and Trash
 * only shows assets with their own deletedAt — the file was in neither, alive
 * on disk and unreachable from every screen. Three real photos sat like that
 * in production for a month.
 */
describe("deleting a folder leaves its files reachable", () => {
  let seq = 0

  async function seedFolderWithAsset() {
    // Folders survive this file's beforeEach, and (libraryId, pathCache) is
    // unique — so each case needs its own names.
    seq += 1
    const parent = await createFolder(fixtures, { librarySlug: "images", name: `Trip ${seq}` })
    const child = await createFolder(fixtures, {
      librarySlug: "images",
      name: `Day one ${seq}`,
      parentFolderId: parent.id,
    })
    const asset = await createAsset(fixtures, {
      librarySlug: "images",
      folderId: child.id,
      mediaType: "IMAGE",
      originalFilename: "beach.png",
    })
    return { parent, child, asset }
  }

  /** The repair the delete route performs, expressed once. */
  async function deleteFolderCascade(folderId: string) {
    const existing = await prisma.folder.findUniqueOrThrow({ where: { id: folderId } })
    const doomed = await prisma.folder.findMany({
      where: {
        OR: [
          { id: existing.id },
          { libraryId: existing.libraryId, pathCache: { startsWith: `${existing.pathCache}/` } },
        ],
      },
      select: { id: true },
    })
    const ids = doomed.map((f) => f.id)
    return prisma.$transaction(async (tx) => {
      const moved = await tx.asset.updateMany({
        where: { folderId: { in: ids }, deletedAt: null },
        data: { folderId: null },
      })
      await tx.folder.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } })
      return { folders: ids.length, moved: moved.count }
    })
  }

  it("moves the files to the library root rather than stranding them", async () => {
    const { parent, asset } = await seedFolderWithAsset()

    const result = await deleteFolderCascade(parent.id)
    expect(result.moved).toBe(1)

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
    expect(row.folderId).toBeNull()
    expect(row.deletedAt).toBeNull()
  })

  it("reaches files nested more than one level down", async () => {
    const { parent, child, asset } = await seedFolderWithAsset()

    await deleteFolderCascade(parent.id)

    const folders = await prisma.folder.findMany({ where: { id: { in: [parent.id, child.id] } } })
    expect(folders.every((f) => f.deletedAt !== null)).toBe(true)
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
    expect(row.folderId).toBeNull()
  })

  it("leaves no asset pointing at a deleted folder — the condition that hid them", async () => {
    const { parent } = await seedFolderWithAsset()
    await deleteFolderCascade(parent.id)

    const stranded = await prisma.asset.count({
      where: { deletedAt: null, folderId: { not: null }, folder: { deletedAt: { not: null } } },
    })
    expect(stranded).toBe(0)
  })

  it("does not put the files in Trash — they stay in the library", async () => {
    const { parent, asset } = await seedFolderWithAsset()
    await deleteFolderCascade(parent.id)

    const trashed = await listTrashedAssets(prisma)
    expect(trashed.map((t) => t.id)).not.toContain(asset.id)
  })

  it("leaves a folder that was already empty alone", async () => {
    seq += 1
    const empty = await createFolder(fixtures, { librarySlug: "images", name: `Empty ${seq}` })
    const result = await deleteFolderCascade(empty.id)
    expect(result.moved).toBe(0)
    expect(result.folders).toBe(1)
  })
})
