import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { initialUploadSessionState } from "@arciin/shared"

import {
  completeUploadSession,
  failUploadSession,
  type CompletionDeps,
} from "../../apps/worker/src/services/upload-completion"
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
 * The completion lifecycle against real PostgreSQL.
 *
 * The unit tests prove the algorithm with a fake `updateMany`; these prove the
 * real conditional update actually behaves as a latch under the real database,
 * which is what guarantees exactly one completion event per upload.
 */

let fixtures: Fixtures
let published: Array<{ type: string; uploadId: string }> = []

/** Real Prisma, captured events. */
function deps(): CompletionDeps {
  return {
    findUploadSession: async ({ uploadId, assetId }) =>
      uploadId
        ? prisma.uploadSession.findUnique({
            where: { id: uploadId },
            include: { targetLibrary: { select: { name: true } } },
          })
        : assetId
          ? prisma.uploadSession.findFirst({
              where: { assetId },
              include: { targetLibrary: { select: { name: true } } },
            })
          : null,
    promoteUploadSession: async ({ id, unlessStatusIn, data }) => {
      const result = await prisma.uploadSession.updateMany({
        where: { id, status: { notIn: unlessStatusIn as never } },
        data: data as never,
      })
      return result.count
    },
    markAssetFailed: async (assetId, message) => {
      await prisma.asset.update({
        where: { id: assetId },
        data: { status: "FAILED", processingError: message },
      })
    },
    publish: async (event) => {
      published.push({ type: event.type, uploadId: event.uploadId })
    },
  }
}

async function createSession(assetId: string, mediaType: string) {
  const lifecycle = initialUploadSessionState(mediaType)
  return prisma.uploadSession.create({
    data: {
      userId: fixtures.user.id,
      originalFilename: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: BigInt(10),
      status: lifecycle.status,
      progress: lifecycle.progress,
      completedAt: lifecycle.completedAt,
      targetLibraryId: fixtures.libraries.videos.id,
      detectedMediaType: mediaType as never,
      assetId,
    },
  })
}

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
})

beforeEach(() => {
  published = []
})

afterAll(async () => {
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

describe("upload session lifecycle in PostgreSQL", () => {
  it("creates media uploads PROCESSING with a null completedAt", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      mediaType: "VIDEO",
      status: "PROCESSING",
    })
    const session = await createSession(asset.id, "VIDEO")

    const stored = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(stored.status).toBe("PROCESSING")
    expect(stored.completedAt).toBeNull()
    expect(stored.progress).toBeLessThan(100)
  })

  it("creates immediately-ready uploads READY with completedAt set", async () => {
    // DOCUMENT/IMAGE/VIDEO/AUDIO need worker jobs; ARCHIVE/OTHER finish at store time.
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      mediaType: "OTHER",
    })
    const session = await createSession(asset.id, "OTHER")

    const stored = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(stored.status).toBe("READY")
    expect(stored.progress).toBe(100)
    expect(stored.completedAt).not.toBeNull()
  })

  it("creates DOCUMENT uploads PROCESSING until the worker finishes metadata", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "documents",
      mediaType: "DOCUMENT",
      status: "PROCESSING",
    })
    const session = await createSession(asset.id, "DOCUMENT")

    const stored = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(stored.status).toBe("PROCESSING")
    expect(stored.completedAt).toBeNull()
    expect(stored.progress).toBeLessThan(100)
  })

  it("promotes PROCESSING to READY and stamps completedAt", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      mediaType: "VIDEO",
      status: "PROCESSING",
    })
    const session = await createSession(asset.id, "VIDEO")

    const completed = await completeUploadSession(deps(), {
      uploadId: session.id,
      assetId: asset.id,
      libraryId: fixtures.libraries.videos.id,
      originalFilename: "clip.mp4",
    })

    const stored = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(completed).toBe(true)
    expect(stored.status).toBe("READY")
    expect(stored.progress).toBe(100)
    expect(stored.completedAt).not.toBeNull()
    expect(published).toHaveLength(1)
  })

  it("emits exactly one completion event when both media jobs finish", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      mediaType: "VIDEO",
      status: "PROCESSING",
    })
    const session = await createSession(asset.id, "VIDEO")

    const input = {
      uploadId: session.id,
      assetId: asset.id,
      libraryId: fixtures.libraries.videos.id,
      originalFilename: "clip.mp4",
    }

    // extract_metadata and generate_thumbnail, order not guaranteed.
    const first = await completeUploadSession(deps(), input)
    const second = await completeUploadSession(deps(), input)

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(published.filter((e) => e.type === "upload.completed")).toHaveLength(1)
  })

  it("emits one completion event even when both jobs finish concurrently", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      mediaType: "VIDEO",
      status: "PROCESSING",
    })
    const session = await createSession(asset.id, "VIDEO")
    const input = {
      uploadId: session.id,
      assetId: asset.id,
      libraryId: fixtures.libraries.videos.id,
      originalFilename: "clip.mp4",
    }

    // The real race: the conditional UPDATE is the only thing serialising them.
    const results = await Promise.all([
      completeUploadSession(deps(), input),
      completeUploadSession(deps(), input),
      completeUploadSession(deps(), input),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(published.filter((e) => e.type === "upload.completed")).toHaveLength(1)
  })

  it("recovers a session stranded at CLASSIFIED", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "images",
      mediaType: "IMAGE",
      status: "PROCESSING",
    })
    const session = await createSession(asset.id, "IMAGE")
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: "CLASSIFIED", progress: 90 },
    })

    const completed = await completeUploadSession(deps(), {
      uploadId: session.id,
      assetId: asset.id,
      libraryId: fixtures.libraries.images.id,
      originalFilename: "photo.jpg",
    })

    const stored = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(completed).toBe(true)
    expect(stored.status).toBe("READY")
  })

  it("marks a failed job FAILED on both the session and the asset", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      mediaType: "VIDEO",
      status: "PROCESSING",
    })
    const session = await createSession(asset.id, "VIDEO")

    const failed = await failUploadSession(
      deps(),
      { uploadId: session.id, assetId: asset.id },
      new Error("Original file missing on disk."),
    )

    const storedSession = await prisma.uploadSession.findUniqueOrThrow({
      where: { id: session.id },
    })
    const storedAsset = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })

    expect(failed).toBe(true)
    expect(storedSession.status).toBe("FAILED")
    expect(storedSession.error).toMatch(/missing on disk/)
    expect(storedAsset.status).toBe("FAILED")
    expect(published).toEqual([{ type: "upload.failed", uploadId: session.id }])
  })

  it("never overwrites a completed upload with a late failure", async () => {
    const asset = await createAsset(fixtures, { librarySlug: "videos", mediaType: "VIDEO" })
    const session = await createSession(asset.id, "VIDEO")
    await completeUploadSession(deps(), {
      uploadId: session.id,
      assetId: asset.id,
      libraryId: fixtures.libraries.videos.id,
      originalFilename: "clip.mp4",
    })
    published = []

    const failed = await failUploadSession(
      deps(),
      { uploadId: session.id, assetId: asset.id },
      new Error("late failure"),
    )

    const stored = await prisma.uploadSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(failed).toBe(false)
    expect(stored.status).toBe("READY")
    expect(published).toHaveLength(0)
  })
})

describe("folder relationships in PostgreSQL", () => {
  it("rejects a folder that belongs to another library", async () => {
    const videosFolder = await createFolder(fixtures, {
      librarySlug: "videos",
      name: "Foreign",
    })

    // The check the upload route performs before writing anything.
    const folder = await prisma.folder.findFirst({
      where: { id: videosFolder.id, deletedAt: null },
    })
    expect(folder).not.toBeNull()
    expect(folder!.libraryId).not.toBe(fixtures.libraries.images.id)
  })

  it("treats a soft-deleted folder as not found", async () => {
    const deleted = await createFolder(fixtures, {
      librarySlug: "videos",
      name: "Gone",
      deletedAt: new Date(),
    })

    const folder = await prisma.folder.findFirst({
      where: { id: deleted.id, deletedAt: null },
    })
    expect(folder).toBeNull()
  })

  it("treats a missing folder id as not found", async () => {
    const folder = await prisma.folder.findFirst({
      where: { id: "does-not-exist", deletedAt: null },
    })
    expect(folder).toBeNull()
  })

  it("accepts a live folder in the target library", async () => {
    const valid = await createFolder(fixtures, { librarySlug: "videos", name: "Valid" })

    const folder = await prisma.folder.findFirst({
      where: { id: valid.id, deletedAt: null },
    })
    expect(folder).not.toBeNull()
    expect(folder!.libraryId).toBe(fixtures.libraries.videos.id)
  })
})
