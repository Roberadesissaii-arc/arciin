import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

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
 * Who may read or request a transcript, and what the stored row guarantees.
 *
 * The access rule is enforced in the route by re-resolving the asset and
 * re-checking folder access, so these assert the properties that rule depends
 * on: a transcript is bound to exactly one asset, a locked folder hides its
 * media, and deleting a video takes its transcript with it rather than leaving
 * readable speech behind.
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
  await prisma.mediaTranscript.deleteMany()
  await prisma.asset.deleteMany()
  await prisma.folder.deleteMany()
})

async function seedTranscript(assetId: string, text: string) {
  return prisma.mediaTranscript.create({
    data: {
      assetId,
      status: "READY",
      provider: "gemini",
      model: "gemini-2.5-flash",
      language: "en",
      fullText: text,
      segments: [{ startMs: 0, text }],
      generatedAt: new Date(),
    },
  })
}

describe("a transcript belongs to exactly one asset", () => {
  it("cannot be created twice for the same video", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "talk.mp4",
      mediaType: "VIDEO",
    })
    await seedTranscript(asset.id, "first")
    // The unique constraint is what makes "the latest transcript" unambiguous
    // and what lets regeneration replace in place.
    await expect(seedTranscript(asset.id, "second")).rejects.toThrow()
  })

  it("is replaced, not duplicated, when regenerated", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "talk.mp4",
      mediaType: "VIDEO",
    })
    await seedTranscript(asset.id, "version A")

    await prisma.mediaTranscript.update({
      where: { assetId: asset.id },
      data: { fullText: "version B", segments: [{ startMs: 0, text: "version B" }], edited: false },
    })

    const rows = await prisma.mediaTranscript.findMany({ where: { assetId: asset.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.fullText).toBe("version B")
  })
})

describe("a transcript never outlives its video", () => {
  it("is deleted with the asset", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "gone.mp4",
      mediaType: "VIDEO",
    })
    await seedTranscript(asset.id, "spoken words that must not survive the file")

    await prisma.asset.delete({ where: { id: asset.id } })

    // Otherwise the words someone recorded would stay readable after they
    // deleted the recording.
    expect(await prisma.mediaTranscript.findUnique({ where: { assetId: asset.id } })).toBeNull()
  })
})

describe("locked folders", () => {
  it("hide the media a transcript would be generated from", async () => {
    const locked = await createFolder(fixtures, {
      librarySlug: "videos",
      name: "Private",
      lockedAt: new Date(),
    })
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      folderId: locked.id,
      originalFilename: "private.mp4",
      mediaType: "VIDEO",
    })

    // The route calls assertAssetFolderAccess with exactly this folder id; the
    // lock is what that check reads.
    const folder = await prisma.folder.findUnique({
      where: { id: locked.id },
      select: { lockedAt: true },
    })
    expect(folder?.lockedAt).not.toBeNull()

    const stored = await prisma.asset.findUnique({
      where: { id: asset.id },
      select: { folderId: true },
    })
    expect(stored?.folderId).toBe(locked.id)
  })
})

describe("the stored shape the drawer reads", () => {
  it("round-trips segments, language and the edited flag", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "multi.mp4",
      mediaType: "VIDEO",
    })
    await prisma.mediaTranscript.create({
      data: {
        assetId: asset.id,
        status: "READY",
        provider: "gemini",
        model: "gemini-2.5-flash",
        // Not English, and not translated — the transcript keeps the language
        // that was spoken.
        language: "am",
        fullText: "ሰላም ለዓለም",
        segments: [
          { startMs: 0, endMs: 2000, text: "ሰላም", speaker: "Speaker 1" },
          { startMs: 2000, text: "ለዓለም" },
        ],
        durationSeconds: 12.5,
        generatedAt: new Date(),
      },
    })

    const row = await prisma.mediaTranscript.findUnique({ where: { assetId: asset.id } })
    expect(row?.language).toBe("am")
    expect(row?.fullText).toContain("ሰላም")
    expect(row?.durationSeconds).toBeCloseTo(12.5)
    expect(row?.edited).toBe(false)
    const segments = row?.segments as { startMs: number; speaker?: string; text: string }[]
    expect(segments).toHaveLength(2)
    expect(segments[0]!.speaker).toBe("Speaker 1")
  })

  it("records a manual correction as edited", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "corrected.mp4",
      mediaType: "VIDEO",
    })
    await seedTranscript(asset.id, "raw output")

    const updated = await prisma.mediaTranscript.update({
      where: { assetId: asset.id },
      data: { fullText: "corrected by hand", edited: true },
    })
    // The flag is what makes Regenerate warn before discarding someone's work.
    expect(updated.edited).toBe(true)
  })

  it("keeps the previous text while a rerun is pending", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "rerun.mp4",
      mediaType: "VIDEO",
    })
    await seedTranscript(asset.id, "the transcript they already had")

    // What the POST route does when queueing a regeneration.
    const pending = await prisma.mediaTranscript.update({
      where: { assetId: asset.id },
      data: { status: "PENDING", error: null },
    })
    expect(pending.status).toBe("PENDING")
    expect(pending.fullText).toBe("the transcript they already had")
  })

  it("stores a typed no-audio outcome rather than an error string", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "silent.mp4",
      mediaType: "VIDEO",
    })
    const row = await prisma.mediaTranscript.create({
      data: { assetId: asset.id, status: "NO_AUDIO", provider: "gemini" },
    })
    // A typed state gets its own message in the drawer; a generic failure does
    // not, which is the difference between "no audio track" and "try again".
    expect(row.status).toBe("NO_AUDIO")
    expect(row.error).toBeNull()
  })
})
