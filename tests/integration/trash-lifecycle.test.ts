import { mkdir, writeFile, access } from "node:fs/promises"
import path from "node:path"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  emptyTrash,
  listTrashedAssets,
  permanentlyDeleteTrashedAsset,
  restoreTrashedAsset,
  trashDaysRemaining,
} from "../../apps/api/src/services/assets/trash"
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
 * Trash: restore, permanent delete, and what each does to the bytes on disk.
 *
 * The claim worth testing is not "the row disappeared" — it is that a restore
 * gives back a usable file and a purge does not take one away from an asset
 * that is still in the library. Content-addressed storage means two assets can
 * share one StorageObject, and deleting the shared file while another row still
 * points at it is how a library ends up full of placeholders. That case is the
 * last test here.
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

/** Put real bytes where the asset's StorageObject says they are. */
async function materialize(assetId: string): Promise<string> {
  const asset = await prisma.asset.findUniqueOrThrow({
    where: { id: assetId },
    include: { storageObject: true },
  })
  const filePath = asset.storageObject.physicalPath
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, "bytes")
  return filePath
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  )
}

describe("restore", () => {
  it("brings a trashed asset back as READY and out of the trash list", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      mediaType: "VIDEO",
      status: "DELETED",
      deletedAt: new Date(),
    })

    expect((await listTrashedAssets(prisma)).map((a) => a.id)).toContain(asset.id)

    const restored = await restoreTrashedAsset(prisma, asset.id)
    expect(restored).not.toBeNull()
    expect(restored!.deletedAt).toBeNull()
    expect(restored!.status).toBe("READY")

    // And it is gone from trash, in the database rather than in a cache.
    expect((await listTrashedAssets(prisma)).map((a) => a.id)).not.toContain(asset.id)
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
    expect(row.deletedAt).toBeNull()
  })

  it("leaves the file on disk untouched", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      status: "DELETED",
      deletedAt: new Date(),
    })
    const filePath = await materialize(asset.id)

    await restoreTrashedAsset(prisma, asset.id)
    expect(await exists(filePath)).toBe(true)
  })

  it("refuses to restore an asset that is not in the trash", async () => {
    const live = await createAsset(fixtures, { librarySlug: "videos" })
    expect(await restoreTrashedAsset(prisma, live.id)).toBeNull()
  })

  it("clears a previous processing error rather than restoring a broken state", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      status: "DELETED",
      deletedAt: new Date(),
    })
    await prisma.asset.update({
      where: { id: asset.id },
      data: { processingError: "thumbnail failed" },
    })

    const restored = await restoreTrashedAsset(prisma, asset.id)
    expect(restored!.processingError).toBeNull()
  })
})

describe("permanent delete", () => {
  it("removes the row, the StorageObject and the bytes", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      status: "DELETED",
      deletedAt: new Date(),
    })
    const filePath = await materialize(asset.id)
    const storageObjectId = (
      await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
    ).storageObjectId

    const purged = await permanentlyDeleteTrashedAsset(prisma, asset.id)
    expect(purged).not.toBeNull()

    expect(await prisma.asset.findUnique({ where: { id: asset.id } })).toBeNull()
    expect(await prisma.storageObject.findUnique({ where: { id: storageObjectId } })).toBeNull()
    expect(await exists(filePath)).toBe(false)
  })

  it("takes any share links to that asset with it", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      status: "DELETED",
      deletedAt: new Date(),
    })
    await materialize(asset.id)

    await prisma.shareLink.create({
      data: {
        createdById: fixtures.user.id,
        resourceType: "ASSET",
        assetId: asset.id,
        tokenHash: `hash-${asset.id}`,
        tokenPrefix: "shr_test",
      },
    })

    await permanentlyDeleteTrashedAsset(prisma, asset.id)

    // A live token pointing at deleted bytes would be a dangling public URL.
    expect(await prisma.shareLink.count({ where: { assetId: asset.id } })).toBe(0)
  })

  it("refuses an asset that is not in the trash", async () => {
    const live = await createAsset(fixtures, { librarySlug: "videos" })
    expect(await permanentlyDeleteTrashedAsset(prisma, live.id)).toBeNull()

    // And the live asset is entirely untouched.
    expect(await prisma.asset.findUnique({ where: { id: live.id } })).not.toBeNull()
  })

  /**
   * The regression this file exists for.
   *
   * Two assets with identical bytes share one StorageObject. Purging one used
   * to unlink the file unconditionally, so emptying the trash destroyed
   * originals still referenced by assets sitting in the library.
   */
  it("keeps the bytes when another asset still points at the same StorageObject", async () => {
    const keep = await createAsset(fixtures, { librarySlug: "videos" })
    const filePath = await materialize(keep.id)

    const keepRow = await prisma.asset.findUniqueOrThrow({ where: { id: keep.id } })

    // A second asset sharing the identical StorageObject, then trashed.
    const duplicate = await prisma.asset.create({
      data: {
        libraryId: keepRow.libraryId,
        storageObjectId: keepRow.storageObjectId,
        ownerId: fixtures.user.id,
        filename: keepRow.filename,
        originalFilename: "duplicate.bin",
        mimeType: keepRow.mimeType,
        mediaType: keepRow.mediaType,
        extension: keepRow.extension,
        sizeBytes: keepRow.sizeBytes,
        checksumSha256: keepRow.checksumSha256,
        status: "DELETED",
        deletedAt: new Date(),
      },
    })

    await permanentlyDeleteTrashedAsset(prisma, duplicate.id)

    expect(await prisma.asset.findUnique({ where: { id: duplicate.id } })).toBeNull()
    // The surviving asset keeps both its row and its file.
    expect(await prisma.asset.findUnique({ where: { id: keep.id } })).not.toBeNull()
    expect(
      await prisma.storageObject.findUnique({ where: { id: keepRow.storageObjectId } }),
    ).not.toBeNull()
    expect(await exists(filePath)).toBe(true)
  })
})

describe("empty trash", () => {
  it("purges every trashed asset and leaves live ones alone", async () => {
    const live = await createAsset(fixtures, { librarySlug: "videos" })
    await materialize(live.id)

    for (let i = 0; i < 3; i += 1) {
      const trashed = await createAsset(fixtures, {
        librarySlug: "videos",
        status: "DELETED",
        deletedAt: new Date(),
      })
      await materialize(trashed.id)
    }

    const removed = await emptyTrash(prisma)
    expect(removed).toBe(3)

    expect(await listTrashedAssets(prisma)).toHaveLength(0)
    expect(await prisma.asset.findUnique({ where: { id: live.id } })).not.toBeNull()
  })
})

describe("retention window", () => {
  it("counts down from the delete date and never reports negative days", () => {
    const justDeleted = new Date()
    expect(trashDaysRemaining(justDeleted)).toBeGreaterThan(0)

    const longExpired = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365)
    expect(trashDaysRemaining(longExpired)).toBe(0)
  })
})
