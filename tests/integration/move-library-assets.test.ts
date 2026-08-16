import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  findAssetsByExactName,
  MAX_MOVES_PER_BATCH,
  moveLibraryAssets,
  undoLibraryAssetMove,
} from "../../apps/api/src/services/assets/move-library-assets"
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
 * The move service, against real PostgreSQL.
 *
 * These are integration rather than unit tests on purpose. Every claim worth
 * making about a move — that the file is really in the new folder, that the old
 * folder no longer lists it, that running the same organisation twice changes
 * nothing the second time — is a claim about rows, and a mocked Prisma client
 * would let all of them pass while the feature was broken.
 *
 * The rule that shapes the whole file: a per-file problem must never cost the
 * batch. A library reorganisation that abandons 238 good moves because 8 files
 * were unreachable is worse than no feature at all.
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

beforeEach(async () => {
  await prisma.asset.deleteMany()
  await prisma.folder.deleteMany()
  await prisma.activityEvent.deleteMany()
})

async function folderContents(folderId: string): Promise<string[]> {
  const rows = await prisma.asset.findMany({
    where: { folderId, deletedAt: null },
    select: { originalFilename: true },
    orderBy: { originalFilename: "asc" },
  })
  return rows.map((r) => r.originalFilename)
}

function run(moves: { assetId: string; destinationFolderId: string | null }[]) {
  return moveLibraryAssets({
    prisma,
    userId: fixtures.user.id,
    moves,
    source: "chat_ai",
  })
}

describe("moving a single file", () => {
  it("puts it in the destination and takes it out of the source", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const source = await createFolder(fixtures, { librarySlug: "documents", name: "Unsorted" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: source.id,
      originalFilename: "The Love Hypothesis.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([{ assetId: asset.id, destinationFolderId: fiction.id }])

    expect(result.moved).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.results[0]).toMatchObject({
      status: "moved",
      fromFolderId: source.id,
      toFolderId: fiction.id,
    })

    // The claim, checked against the database rather than the return value.
    expect(await folderContents(fiction.id)).toEqual(["The Love Hypothesis.pdf"])
    expect(await folderContents(source.id)).toEqual([])
  })

  it("moves a file that was loose in the library root", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: null,
      originalFilename: "Loose.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([{ assetId: asset.id, destinationFolderId: fiction.id }])
    expect(result.moved).toBe(1)
    expect(await folderContents(fiction.id)).toEqual(["Loose.pdf"])
  })

  it("can put a file back at the library root", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: fiction.id,
      originalFilename: "Back.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([{ assetId: asset.id, destinationFolderId: null }])
    expect(result.moved).toBe(1)
    const row = await prisma.asset.findUnique({ where: { id: asset.id } })
    expect(row?.folderId).toBeNull()
  })
})

describe("batch moves", () => {
  it("distributes files across several destinations in one call", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const programming = await createFolder(fixtures, {
      librarySlug: "documents",
      name: "Programming",
    })
    const science = await createFolder(fixtures, { librarySlug: "documents", name: "Science" })

    const novel = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "A Novel.pdf",
      mediaType: "DOCUMENT",
    })
    const python = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Python Crash Course.pdf",
      mediaType: "DOCUMENT",
    })
    const mars = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "How We'll Live on Mars.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([
      { assetId: novel.id, destinationFolderId: fiction.id },
      { assetId: python.id, destinationFolderId: programming.id },
      { assetId: mars.id, destinationFolderId: science.id },
    ])

    expect(result.moved).toBe(3)
    expect(await folderContents(fiction.id)).toEqual(["A Novel.pdf"])
    expect(await folderContents(programming.id)).toEqual(["Python Crash Course.pdf"])
    expect(await folderContents(science.id)).toEqual(["How We'll Live on Mars.pdf"])
  })

  it("refuses a batch larger than the cap rather than half-applying it", async () => {
    const folder = await createFolder(fixtures, { librarySlug: "documents", name: "Big" })
    const moves = Array.from({ length: MAX_MOVES_PER_BATCH + 1 }, (_, i) => ({
      assetId: `fake-${i}`,
      destinationFolderId: folder.id,
    }))
    await expect(run(moves)).rejects.toThrow(/Too many moves/)
  })
})

describe("running the same organisation twice", () => {
  it("reports the second pass as already_there and writes nothing", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Twice.pdf",
      mediaType: "DOCUMENT",
    })

    const first = await run([{ assetId: asset.id, destinationFolderId: fiction.id }])
    expect(first.moved).toBe(1)

    const second = await run([{ assetId: asset.id, destinationFolderId: fiction.id }])
    expect(second.moved).toBe(0)
    expect(second.alreadyThere).toBe(1)
    expect(second.failed).toBe(0)

    // Still exactly one row — a no-op must not duplicate the file.
    expect(await folderContents(fiction.id)).toEqual(["Twice.pdf"])

    // And no second audit entry, so the feed is not filled by a re-run.
    const events = await prisma.activityEvent.findMany({ where: { type: "assets.moved" } })
    expect(events).toHaveLength(1)
  })
})

describe("name collisions", () => {
  it("keeps both files and flags the collision instead of overwriting", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const sitting = await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: fiction.id,
      originalFilename: "The Atlantis World.pdf",
      mediaType: "DOCUMENT",
    })
    const arriving = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "The Atlantis World.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([{ assetId: arriving.id, destinationFolderId: fiction.id }])

    expect(result.moved).toBe(1)
    expect(result.results[0]?.nameCollision).toBe(true)

    // Two distinct rows, both still present. A move is a reparent, so there is
    // no filesystem write that could clobber the first file.
    const rows = await prisma.asset.findMany({
      where: { folderId: fiction.id, deletedAt: null },
      select: { id: true, storageObjectId: true },
    })
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([sitting.id, arriving.id]))
    expect(new Set(rows.map((r) => r.storageObjectId)).size).toBe(2)
  })
})

describe("things that must not happen", () => {
  it("fails a move to a folder that does not exist, without touching the file", async () => {
    const source = await createFolder(fixtures, { librarySlug: "documents", name: "Unsorted" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: source.id,
      originalFilename: "Stays.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([{ assetId: asset.id, destinationFolderId: "does-not-exist" }])
    expect(result.failed).toBe(1)
    expect(result.results[0]?.code).toBe("destination_not_found")
    expect(await folderContents(source.id)).toEqual(["Stays.pdf"])
  })

  it("fails a move into a deleted folder", async () => {
    const gone = await createFolder(fixtures, {
      librarySlug: "documents",
      name: "Gone",
      deletedAt: new Date(),
    })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Nope.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([{ assetId: asset.id, destinationFolderId: gone.id }])
    expect(result.results[0]?.code).toBe("destination_not_found")
  })

  it("refuses to move into a locked folder", async () => {
    const locked = await createFolder(fixtures, {
      librarySlug: "documents",
      name: "Private",
      lockedAt: new Date(),
    })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Sensitive.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([{ assetId: asset.id, destinationFolderId: locked.id }])
    expect(result.failed).toBe(1)
    expect(result.results[0]?.code).toBe("destination_locked")
    expect(await folderContents(locked.id)).toEqual([])
  })

  it("refuses to move a file out of a locked folder", async () => {
    const locked = await createFolder(fixtures, {
      librarySlug: "documents",
      name: "Private",
      lockedAt: new Date(),
    })
    const open = await createFolder(fixtures, { librarySlug: "documents", name: "Open" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      folderId: locked.id,
      originalFilename: "Secret.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([{ assetId: asset.id, destinationFolderId: open.id }])
    expect(result.results[0]?.code).toBe("source_locked")
    expect(await folderContents(locked.id)).toEqual(["Secret.pdf"])
  })

  it("lets an authorised caller through the same lock", async () => {
    const locked = await createFolder(fixtures, {
      librarySlug: "documents",
      name: "Private",
      lockedAt: new Date(),
    })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Allowed.pdf",
      mediaType: "DOCUMENT",
    })

    // What the HTTP route passes for a user who has answered the lock.
    const result = await moveLibraryAssets({
      prisma,
      userId: fixtures.user.id,
      moves: [{ assetId: asset.id, destinationFolderId: locked.id }],
      folderAccessGranted: () => true,
      source: "api",
    })
    expect(result.moved).toBe(1)
  })

  it("will not move a folder, even if its id is passed as a file", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const other = await createFolder(fixtures, { librarySlug: "documents", name: "Other" })

    const result = await run([{ assetId: other.id, destinationFolderId: fiction.id }])
    expect(result.failed).toBe(1)
    expect(result.results[0]?.code).toBe("asset_is_folder")

    // The folder is untouched — still a root folder, not reparented.
    const row = await prisma.folder.findUnique({ where: { id: other.id } })
    expect(row?.parentFolderId ?? null).toBeNull()
  })

  it("fails an unknown file id", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const result = await run([{ assetId: "nope", destinationFolderId: fiction.id }])
    expect(result.results[0]?.code).toBe("asset_not_found")
  })

  it("will not move a trashed file", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const trashed = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Deleted.pdf",
      mediaType: "DOCUMENT",
      deletedAt: new Date(),
    })
    const result = await run([{ assetId: trashed.id, destinationFolderId: fiction.id }])
    expect(result.results[0]?.code).toBe("asset_not_found")
  })

  it("rejects the same file listed twice in one batch", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const other = await createFolder(fixtures, { librarySlug: "documents", name: "Other" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Once.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([
      { assetId: asset.id, destinationFolderId: fiction.id },
      { assetId: asset.id, destinationFolderId: other.id },
    ])
    expect(result.moved).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.results.some((r) => r.code === "duplicate_in_batch")).toBe(true)
    expect(await folderContents(fiction.id)).toEqual(["Once.pdf"])
    expect(await folderContents(other.id)).toEqual([])
  })
})

describe("partial failure", () => {
  it("keeps every good move and reports each bad one separately", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const locked = await createFolder(fixtures, {
      librarySlug: "documents",
      name: "Locked",
      lockedAt: new Date(),
    })

    const good = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createAsset(fixtures, {
          librarySlug: "documents",
          originalFilename: `Good ${i}.pdf`,
          mediaType: "DOCUMENT",
        }),
      ),
    )
    const blocked = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Blocked.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([
      ...good.map((a) => ({ assetId: a.id, destinationFolderId: fiction.id })),
      { assetId: blocked.id, destinationFolderId: locked.id },
      { assetId: "ghost", destinationFolderId: fiction.id },
    ])

    expect(result.moved).toBe(6)
    expect(result.failed).toBe(2)
    expect(result.requested).toBe(8)
    // The six that worked are really there — a partial failure is not a rollback.
    expect(await folderContents(fiction.id)).toHaveLength(6)

    const codes = result.results.filter((r) => r.status === "failed").map((r) => r.code)
    expect(codes).toContain("destination_locked")
    expect(codes).toContain("asset_not_found")
  })
})

describe("the audit trail", () => {
  it("records one grouped event carrying every before/after pair", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const source = await createFolder(fixtures, { librarySlug: "documents", name: "Unsorted" })
    const assets = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        createAsset(fixtures, {
          librarySlug: "documents",
          folderId: source.id,
          originalFilename: `Book ${i}.pdf`,
          mediaType: "DOCUMENT",
        }),
      ),
    )

    const result = await run(
      assets.map((a) => ({ assetId: a.id, destinationFolderId: fiction.id })),
    )

    const events = await prisma.activityEvent.findMany({ where: { type: "assets.moved" } })
    expect(events).toHaveLength(1)
    const metadata = events[0]!.metadata as {
      operationId: string
      source: string
      moves: Array<{ assetId: string; from: string | null; to: string | null }>
    }
    expect(metadata.operationId).toBe(result.operationId)
    expect(metadata.source).toBe("chat_ai")
    expect(metadata.moves).toHaveLength(4)
    // Every row knows where it came from, which is what makes undo possible.
    expect(metadata.moves.every((m) => m.from === source.id && m.to === fiction.id)).toBe(true)
  })

  it("can put a whole organisation back where it came from", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const source = await createFolder(fixtures, { librarySlug: "documents", name: "Unsorted" })
    const assets = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        createAsset(fixtures, {
          librarySlug: "documents",
          folderId: source.id,
          originalFilename: `Undo ${i}.pdf`,
          mediaType: "DOCUMENT",
        }),
      ),
    )

    const forward = await run(
      assets.map((a) => ({ assetId: a.id, destinationFolderId: fiction.id })),
    )
    expect(await folderContents(fiction.id)).toHaveLength(3)

    const undone = await undoLibraryAssetMove({
      prisma,
      userId: fixtures.user.id,
      operationId: forward.operationId,
    })

    expect("error" in undone).toBe(false)
    expect(await folderContents(source.id)).toHaveLength(3)
    expect(await folderContents(fiction.id)).toEqual([])
  })

  it("refuses to undo an operation id it has no record of", async () => {
    const undone = await undoLibraryAssetMove({
      prisma,
      userId: fixtures.user.id,
      operationId: "mv_nothing",
    })
    expect(undone).toEqual({ error: "operation_not_found" })
  })
})

describe("zero-byte files", () => {
  it("moves them like any other file — flagging is the caller's job, not a crash", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const empty = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "The Love Hypothesis.pdf",
      mediaType: "DOCUMENT",
      sizeBytes: 0,
    })

    const result = await run([{ assetId: empty.id, destinationFolderId: fiction.id }])
    expect(result.moved).toBe(1)

    const row = await prisma.asset.findUnique({
      where: { id: empty.id },
      select: { folderId: true, sizeBytes: true },
    })
    expect(row?.folderId).toBe(fiction.id)
    // The listing tool is what surfaces this to the assistant as is_empty.
    expect(Number(row?.sizeBytes)).toBe(0)
  })
})

describe("recovering a mistyped id", () => {
  /**
   * A real run fumbled one cuid out of 245 — an inserted character — and the
   * book was left behind while the other 239 filed correctly. The name the
   * caller already had is enough to find it again.
   */
  it("finds the file by exact name and completes the move", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "The Atlantis Plague.pdf",
      mediaType: "DOCUMENT",
    })

    // One character inserted, exactly like the observed failure.
    const typo = `${asset.id.slice(0, 12)}4${asset.id.slice(12)}`
    expect(typo).not.toBe(asset.id)

    const result = await run([
      {
        assetId: typo,
        destinationFolderId: fiction.id,
        filename: "The Atlantis Plague.pdf",
      },
    ])

    expect(result.moved).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.recovered).toBe(1)
    expect(result.results[0]).toMatchObject({ assetId: asset.id, recoveredByName: true })
    expect(await folderContents(fiction.id)).toEqual(["The Atlantis Plague.pdf"])
  })

  it("refuses to guess when two files share the name", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "The Atlantis World.pdf",
      mediaType: "DOCUMENT",
    })
    await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "The Atlantis World.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([
      {
        assetId: "definitely-not-an-id",
        destinationFolderId: fiction.id,
        filename: "The Atlantis World.pdf",
      },
    ])

    // Moving the wrong one of two identically named books is worse than not
    // moving either. This is reported, not resolved.
    expect(result.moved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.results[0]?.code).toBe("ambiguous_name")
    expect(await folderContents(fiction.id)).toEqual([])
  })

  it("does not fuzzy-match a name that is merely similar", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "The Atlantis Gene.pdf",
      mediaType: "DOCUMENT",
    })

    const result = await run([
      {
        assetId: "wrong-id",
        destinationFolderId: fiction.id,
        // Close, but not the same book.
        filename: "The Atlantis Genes.pdf",
      },
    ])
    expect(result.failed).toBe(1)
    expect(result.results[0]?.code).toBe("asset_not_found")
    expect(await folderContents(fiction.id)).toEqual([])
  })

  it("still fails cleanly when no filename was supplied", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Lonely.pdf",
      mediaType: "DOCUMENT",
    })
    const result = await run([{ assetId: "nope", destinationFolderId: fiction.id }])
    expect(result.results[0]?.code).toBe("asset_not_found")
    expect(result.recovered).toBe(0)
  })

  it("will not resurrect a trashed file through its name", async () => {
    const fiction = await createFolder(fixtures, { librarySlug: "documents", name: "Fiction" })
    await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Binned.pdf",
      mediaType: "DOCUMENT",
      deletedAt: new Date(),
    })
    const result = await run([
      { assetId: "bad", destinationFolderId: fiction.id, filename: "Binned.pdf" },
    ])
    expect(result.results[0]?.code).toBe("asset_not_found")
  })

  it("matches the name exactly, ignoring only case", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      originalFilename: "Chess For Dummies.pdf",
      mediaType: "DOCUMENT",
    })
    expect(
      (await findAssetsByExactName(prisma, { name: "chess for dummies.pdf" })).map((m) => m.id),
    ).toEqual([asset.id])
    // Not a prefix, not a substring — exact.
    expect(await findAssetsByExactName(prisma, { name: "Chess For Dummies" })).toEqual([])
    expect(await findAssetsByExactName(prisma, { name: "Chess" })).toEqual([])
  })
})
