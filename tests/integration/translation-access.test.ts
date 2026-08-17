import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

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
 * Who may translate, and what a saved translation guarantees.
 *
 * Translation and title generation both spend money and both read someone's
 * private speech, so the rule is the same one transcripts already follow: the
 * asset is re-resolved against the caller every time. These assert the storage
 * properties that rule and the UI depend on.
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
  await prisma.mediaTranslation.deleteMany()
  await prisma.mediaTranscript.deleteMany()
  await prisma.asset.deleteMany()
  await prisma.folder.deleteMany()
})

const SEGMENTS = [
  { startMs: 0, endMs: 4000, speaker: "Speaker 1", text: "Hello everyone." },
  { startMs: 5000, endMs: 9000, speaker: "Speaker 2", text: "Today we're discussing Arciin." },
]

async function seedTranscript(assetId: string) {
  return prisma.mediaTranscript.create({
    data: {
      assetId,
      status: "READY",
      provider: "gemini",
      model: "gemini-2.5-flash",
      language: "en",
      fullText: SEGMENTS.map((s) => s.text).join("\n"),
      segments: SEGMENTS,
      generatedAt: new Date(),
    },
  })
}

async function seedTranslation(transcriptId: string, language: string, sourceUpdatedAt: Date) {
  return prisma.mediaTranslation.create({
    data: {
      transcriptId,
      language,
      status: "READY",
      provider: "gemini",
      model: "gemini-2.5-flash",
      fullText: "Hola a todos.\nHoy hablamos de Arciin.",
      // Timings carried from the original, which is the whole contract.
      segments: SEGMENTS.map((s, i) => ({
        ...s,
        text: i === 0 ? "Hola a todos." : "Hoy hablamos de Arciin.",
      })),
      sourceUpdatedAt,
      generatedAt: new Date(),
    },
  })
}

describe("a translation belongs to one transcript", () => {
  it("cannot be saved twice for the same language", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "talk.mp4",
      mediaType: "VIDEO",
    })
    const transcript = await seedTranscript(asset.id)
    await seedTranslation(transcript.id, "es", transcript.updatedAt)

    // The unique pair is what makes "regenerate" replace rather than pile up.
    await expect(seedTranslation(transcript.id, "es", transcript.updatedAt)).rejects.toThrow()
  })

  it("holds several languages at once, beside the untouched original", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "talk.mp4",
      mediaType: "VIDEO",
    })
    const transcript = await seedTranscript(asset.id)
    await seedTranslation(transcript.id, "es", transcript.updatedAt)
    await seedTranslation(transcript.id, "am", transcript.updatedAt)

    const saved = await prisma.mediaTranscript.findUnique({
      where: { assetId: asset.id },
      include: { translations: true },
    })
    expect(saved!.translations.map((t) => t.language).sort()).toEqual(["am", "es"])
    // The original is still the original.
    expect(saved!.language).toBe("en")
    expect(saved!.fullText).toContain("Hello everyone.")
  })

  it("keeps the original timings on the saved rows", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "talk.mp4",
      mediaType: "VIDEO",
    })
    const transcript = await seedTranscript(asset.id)
    const translation = await seedTranslation(transcript.id, "es", transcript.updatedAt)

    const segments = translation.segments as { startMs: number; speaker?: string }[]
    expect(segments.map((s) => s.startMs)).toEqual([0, 5000])
    expect(segments.map((s) => s.speaker)).toEqual(["Speaker 1", "Speaker 2"])
  })

  it("goes when the transcript goes", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "talk.mp4",
      mediaType: "VIDEO",
    })
    const transcript = await seedTranscript(asset.id)
    const translation = await seedTranslation(transcript.id, "es", transcript.updatedAt)

    await prisma.mediaTranscript.delete({ where: { id: transcript.id } })
    expect(await prisma.mediaTranslation.findUnique({ where: { id: translation.id } })).toBeNull()
  })

  it("goes when the video goes, leaving no readable speech behind", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "talk.mp4",
      mediaType: "VIDEO",
    })
    const transcript = await seedTranscript(asset.id)
    const translation = await seedTranslation(transcript.id, "es", transcript.updatedAt)

    await prisma.asset.delete({ where: { id: asset.id } })
    expect(await prisma.mediaTranslation.findUnique({ where: { id: translation.id } })).toBeNull()
  })
})

describe("staleness", () => {
  it("marks a translation older than the transcript it came from", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "talk.mp4",
      mediaType: "VIDEO",
    })
    const transcript = await seedTranscript(asset.id)
    const translation = await seedTranslation(transcript.id, "es", transcript.updatedAt)

    // The reader corrects the original.
    const edited = await prisma.mediaTranscript.update({
      where: { id: transcript.id },
      data: { fullText: "Hello everyone. Actually, welcome.", edited: true },
    })

    // Derived on read, so one edit marks every language at once.
    expect(translation.sourceUpdatedAt!.getTime()).toBeLessThan(edited.updatedAt.getTime())
  })

  it("is not stale when nothing has changed", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "talk.mp4",
      mediaType: "VIDEO",
    })
    const transcript = await seedTranscript(asset.id)
    const translation = await seedTranslation(transcript.id, "es", transcript.updatedAt)

    const fresh = await prisma.mediaTranscript.findUnique({ where: { id: transcript.id } })
    expect(translation.sourceUpdatedAt!.getTime()).toBeGreaterThanOrEqual(
      fresh!.updatedAt.getTime(),
    )
  })
})

describe("a translation is reachable only through its own asset", () => {
  it("is not found by another user's scoped lookup", async () => {
    const asset = await createAsset(fixtures, {
      librarySlug: "videos",
      originalFilename: "private-talk.mp4",
      mediaType: "VIDEO",
    })
    const transcript = await seedTranscript(asset.id)
    await seedTranslation(transcript.id, "es", transcript.updatedAt)

    const other = await prisma.user.create({
      data: {
        email: `other-${Date.now()}@example.invalid`,
        name: "Someone Else",
        passwordHash: "not-a-real-hash",
        role: "MEMBER",
        status: "ACTIVE",
      },
    })

    /**
     * The route resolves the asset before it ever reads a transcript, so this
     * is the query that decides. Knowing the asset id is not access — and both
     * translation and title generation spend money, so an unauthorised caller
     * could otherwise run up someone else's bill on their private speech.
     */
    const theirs = await prisma.asset.findFirst({
      where: { id: asset.id, ownerId: other.id, deletedAt: null },
    })
    expect(theirs).toBeNull()

    const mine = await prisma.asset.findFirst({
      where: { id: asset.id, ownerId: fixtures.user.id, deletedAt: null },
    })
    expect(mine).not.toBeNull()
  })
})
