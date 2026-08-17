import { execFile } from "node:child_process"
import { mkdir, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import IORedis from "ioredis"

import { JOB_TYPES } from "@arciin/config"

import {
  createAsset,
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "../integration/setup"

const run = promisify(execFile)

/**
 * The dub job, end to end, without spending anything.
 *
 * The two expensive stages are stubbed and nothing else is. Separation on this
 * hardware is ninety minutes of CPU for a twelve-minute file, and synthesis
 * costs money per request; those are replaced with fakes that produce real audio
 * files. Everything else — the ffmpeg calls, the storage writes, the row
 * updates, the temp cleanup — runs for real, because those are the parts that
 * have actually broken.
 *
 * What is being protected here is mostly the failure paths. A dub that succeeds
 * is easy to notice; a dub that fails and leaves the status stuck on
 * "separating", or dumps a process log into a column the browser renders, or
 * abandons six gigabytes of stems in temp, is not.
 */

/** Controls what the stubbed stages do for a given test. */
const behaviour = {
  separate: "ok" as "ok" | "throw-tool-error" | "throw-plain",
  synthesize: "ok" as "ok" | "throw",
  /** Progress readings the fake separator will emit. */
  progress: [] as { completed: number; total: number; percent: number }[],
  /** Every stage the worker wrote, in order. */
  stages: [] as { status: string; stage: string | null }[],
  /** Runs inside the fake separator, after its progress has been reported. */
  afterProgress: null as null | (() => Promise<void>),
}

vi.mock("@arciin/media-ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const { MediaToolError } = actual as {
    MediaToolError: new (input: Record<string, unknown>) => Error
  }

  /**
   * A separator that writes plausible stems instead of doing the work.
   *
   * It still emits progress and still produces the four Demucs stem names, so
   * the worker's stem-summing path and its progress plumbing are exercised
   * rather than skipped.
   */
  class FakeSeparatorBackend {
    readonly id = "fake-separator"
    async isAvailable() {
      return true
    }
    async separate(request: {
      workDir: string
      onStage?: (s: string) => void
      onProgress?: (p: { completed: number; total: number; percent: number }) => void
      onDiagnostics?: (o: string) => void | Promise<void>
    }) {
      request.onStage?.("Separating dialogue from background")
      for (const reading of behaviour.progress) request.onProgress?.(reading)
      // Lets a test look at the persisted row while the job is still here.
      await behaviour.afterProgress?.()
      await request.onDiagnostics?.("fake separator log\n39/122\n")

      if (behaviour.separate === "throw-tool-error") {
        throw new MediaToolError({
          tool: "audio-separator",
          summary: "audio-separator exited with code 1.",
          detail: "Command failed: /srv/arce-projects/arciin-separator/bin/audio-separator\nboom",
          exitCode: 1,
        })
      }
      if (behaviour.separate === "throw-plain") {
        throw new Error("x".repeat(5000))
      }

      // Real one-second WAVs, named the way Demucs names them.
      const stems: Record<string, string> = {}
      for (const name of ["(Vocals)", "(Drums)", "(Bass)", "(Other)"]) {
        const file = path.join(request.workDir, `source_${name}_htdemucs.wav`)
        await silentWav(file, 1)
        stems[name] = file
      }
      return {
        dialoguePath: stems["(Vocals)"]!,
        backgroundPath: stems["(Other)"]!,
        strategy: "separated" as const,
      }
    }
  }

  return {
    ...actual,
    AudioSeparatorBackend: FakeSeparatorBackend,
    async resolveGeminiMediaConfig() {
      return { apiKey: "not-a-real-key", model: "fake-tts" }
    },
    async synthesizeDubChunk(input: { segments: { startMs: number; endMs?: number }[] }) {
      if (behaviour.synthesize === "throw") throw new Error("the voice model refused")
      const first = input.segments[0]!
      const durationMs = Math.max(200, (first.endMs ?? first.startMs + 1000) - first.startMs)
      // 24 kHz mono 16-bit silence of about the right length, so the timing
      // maths downstream gets a real number to work with.
      const samples = Math.round((durationMs / 1000) * 24_000)
      return { pcm: Buffer.alloc(samples * 2), durationMs }
    },
  }
})

/** A real, tiny WAV — ffmpeg has to be able to open these. */
async function silentWav(file: string, seconds: number) {
  await mkdir(path.dirname(file), { recursive: true })
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo`,
    "-t", String(seconds), file,
  ])
}

let fixtures: Fixtures
let storageRoot: string
/**
 * A real client against the isolated test database.
 *
 * The handler takes the machine's separation lock through Redis, and that is
 * worth exercising rather than stubbing: "only one separation at a time" is a
 * property of the lock, and a fake would assert only that the code calls
 * something.
 */
let redis: IORedis
/** Imported after the mock is registered, so the dynamic import picks it up. */
let handleMediaJob: typeof import("../../apps/worker/src/processors/worker-handlers")["handleMediaJob"]

beforeAll(async () => {
  storageRoot = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(storageRoot)
  redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null })
  ;({ handleMediaJob } = await import("../../apps/worker/src/processors/worker-handlers"))
}, 120_000)

afterAll(async () => {
  await redis.quit().catch(() => {})
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  behaviour.separate = "ok"
  behaviour.synthesize = "ok"
  behaviour.progress = []
  behaviour.stages = []
  behaviour.afterProgress = null
  await prisma.mediaDub.deleteMany()
  await prisma.mediaTranslation.deleteMany()
  await prisma.mediaTranscript.deleteMany()
  await prisma.job.deleteMany()
  // A lock left by a failed run would block every test after it.
  await redis.del("arciin:separation:local")
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * A video with a transcript, a translation and a queued dub — the state the API
 * leaves behind when someone presses Generate.
 */
async function seedDubJob(options: { segments?: number } = {}) {
  const count = options.segments ?? 2
  // Unique per seed: object keys are content-addressed and unique, and every
  // test in this file seeds its own asset.
  const slug = `dub-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const source = path.join(storageRoot, "objects", "aa", "bb", `${slug}.mp4`)
  await mkdir(path.dirname(source), { recursive: true })
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=3",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source,
  ])

  const asset = await createAsset(fixtures, {
    librarySlug: "videos",
    mediaType: "VIDEO",
    originalFilename: "dub-source.mp4",
    extension: "mp4",
  })
  await prisma.asset.update({
    where: { id: asset.id },
    data: { durationSeconds: 3 },
  })
  await prisma.storageObject.update({
    where: { id: asset.storageObjectId },
    data: { physicalPath: source, objectKey: `objects/aa/bb/${slug}.mp4` },
  })

  const segments = Array.from({ length: count }, (_, i) => ({
    startMs: i * 1000,
    endMs: (i + 1) * 1000,
    speaker: i % 2 === 0 ? "Speaker 1" : "Speaker 2",
    text: `line ${i + 1}`,
  }))

  const transcript = await prisma.mediaTranscript.create({
    data: {
      assetId: asset.id,
      status: "READY",
      language: "en",
      segments,
      fullText: segments.map((s) => s.text).join("\n"),
    },
  })
  const translation = await prisma.mediaTranslation.create({
    data: {
      transcriptId: transcript.id,
      language: "es",
      status: "READY",
      segments: segments.map((s) => ({ ...s, text: `linea ${s.startMs}` })),
      fullText: "x",
    },
  })
  const job = await prisma.job.create({
    data: { type: "DUB_MEDIA", status: "QUEUED", progress: 0, payload: {} },
  })
  const dub = await prisma.mediaDub.create({
    data: {
      assetId: asset.id,
      transcriptId: transcript.id,
      translationId: translation.id,
      language: "es",
      status: "PENDING",
      stage: "Queued",
      jobId: job.id,
      voiceProfiles: [
        { speakerId: "Speaker 1", selectedGeminiVoice: "Kore", presentation: "auto" },
        { speakerId: "Speaker 2", selectedGeminiVoice: "Puck", presentation: "auto" },
      ],
    },
  })

  return { asset, dub, job, translation, workDir: path.join(storageRoot, "temp", `dub-${dub.id}`) }
}

/** Runs the handler the way the queue does. */
async function runDub(seed: Awaited<ReturnType<typeof seedDubJob>>) {
  await handleMediaJob(
    JOB_TYPES.dubMedia,
    {
      assetId: seed.asset.id,
      dubId: seed.dub.id,
      translationId: seed.translation.id,
      language: "es",
      jobRecordId: seed.job.id,
    } as never,
    redis as never,
  )
  return prisma.mediaDub.findUniqueOrThrow({ where: { id: seed.dub.id } })
}

describe("dub worker: the happy path", () => {
  it("walks the stages and ends with playable audio", async () => {
    const seed = await seedDubJob()
    behaviour.progress = [
      { completed: 0, total: 122, percent: 0 },
      { completed: 61, total: 122, percent: 50 },
      { completed: 122, total: 122, percent: 100 },
    ]

    const dub = await runDub(seed)

    expect(dub.status, `error was: ${dub.error} / ${dub.errorDetail}`).not.toBe("FAILED")
    expect(["READY", "NEEDS_REVIEW"]).toContain(dub.status)
    expect(dub.audioStorageObjectId, "audio was stored").toBeTruthy()
    expect(dub.backgroundStrategy).toBe("separated")
    expect(dub.generatedAt).toBeTruthy()
    // Finished work reports no stage: a leftover "mixing" reads as still running.
    expect(dub.stage).toBeNull()
    expect(dub.error).toBeNull()

    const job = await prisma.job.findUniqueOrThrow({ where: { id: seed.job.id } })
    expect(job.status).toBe("COMPLETED")
    expect(job.progress).toBe(100)
  }, 120_000)

  it("persists the separator's real counter as it goes", async () => {
    const seed = await seedDubJob()
    behaviour.progress = [{ completed: 39, total: 122, percent: 32 }]

    /**
     * Read from the database while the job is still separating.
     *
     * The fake separator waits, mid-`separate()`, for the row to show what it
     * just reported — so this asserts the actual write path rather than a spy on
     * it, and it asserts it at the moment that matters, before the later stages
     * overwrite the numbers.
     */
    let observed: {
      status: string
      stage: string | null
      current: number | null
      total: number | null
      percent: number | null
    } | null = null

    behaviour.afterProgress = async () => {
      for (let attempt = 0; attempt < 50 && !observed; attempt += 1) {
        const row = await prisma.mediaDub.findUniqueOrThrow({ where: { id: seed.dub.id } })
        if (row.progressCurrent === 39) {
          observed = {
            status: row.status,
            stage: row.stage,
            current: row.progressCurrent,
            total: row.progressTotal,
            percent: row.progressPercent,
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
      }
    }

    await runDub(seed)

    expect(observed).toEqual({
      status: "SEPARATING",
      stage: "Separating dialogue from background",
      current: 39,
      total: 122,
      percent: 32,
    })
  }, 120_000)

  it("stores what was actually spoken, per line", async () => {
    const seed = await seedDubJob({ segments: 2 })
    const dub = await runDub(seed)
    const script = dub.dubScript as { sourceText: string; spokenText: string }[]
    expect(Array.isArray(script)).toBe(true)
    expect(script.length).toBeGreaterThan(0)
  }, 120_000)

  it("clears the work directory when it succeeds", async () => {
    const seed = await seedDubJob()
    await runDub(seed)
    // Stems and clips for a feature-length video are gigabytes; leaving them is
    // how a self-hosted box fills its disk overnight.
    expect(existsSync(seed.workDir), "temp work directory removed").toBe(false)
  }, 120_000)
})

describe("dub worker: failures", () => {
  it("records a separator failure without dumping its output into the row", async () => {
    const seed = await seedDubJob()
    behaviour.separate = "throw-tool-error"

    const dub = await runDub(seed)

    expect(dub.status).toBe("FAILED")
    expect(dub.stage, "a failed dub is not still separating").toBeNull()
    expect(dub.error).toContain("Audio separation failed")

    /**
     * The defect this guards. The raw command line and its log used to be the
     * error message, so the panel rendered the server's directory layout.
     */
    expect(dub.error).not.toContain("Command failed:")
    expect(dub.error).not.toContain("/srv/arce-projects")
    expect(dub.error!.length).toBeLessThan(300)

    // Kept, but bounded, sanitised and behind a disclosure.
    expect(dub.errorDetail).toBeTruthy()
    expect(dub.errorDetail).toContain("boom")
    expect(dub.errorDetail).not.toContain("/srv/arce-projects")

    const job = await prisma.job.findUniqueOrThrow({ where: { id: seed.job.id } })
    expect(job.status).toBe("FAILED")
  }, 120_000)

  it("refuses to present a five-kilobyte exception as a sentence", async () => {
    const seed = await seedDubJob()
    behaviour.separate = "throw-plain"

    const dub = await runDub(seed)
    expect(dub.status).toBe("FAILED")
    expect(dub.error!.length).toBeLessThan(300)
    expect(dub.error).toMatch(/technical details/i)
  }, 120_000)

  it("records a synthesis failure", async () => {
    const seed = await seedDubJob()
    behaviour.synthesize = "throw"

    const dub = await runDub(seed)
    expect(dub.status).toBe("FAILED")
    expect(dub.error).toContain("voice model refused")
    expect(dub.audioStorageObjectId).toBeNull()
  }, 120_000)

  it("records a mixing failure rather than storing a broken file", async () => {
    const seed = await seedDubJob()
    // The background stem is removed after separation, so ffmpeg's mix fails on
    // a missing input — a real ffmpeg error, not a stubbed one.
    const media = await import("@arciin/media-ai")
    vi.spyOn(media, "buildMixArgs").mockReturnValue([
      "-y", "-i", path.join(storageRoot, "definitely-not-here.wav"),
      path.join(storageRoot, "temp", "nope.m4a"),
    ])

    const dub = await runDub(seed)
    expect(dub.status).toBe("FAILED")
    expect(dub.audioStorageObjectId).toBeNull()
  }, 120_000)

  it("clears the work directory when it fails, too", async () => {
    const seed = await seedDubJob()
    behaviour.separate = "throw-tool-error"

    await runDub(seed)
    // The path that actually matters: a job that dies part-way is exactly when
    // the largest intermediates exist.
    expect(existsSync(seed.workDir), "temp work directory removed on failure").toBe(false)
  }, 120_000)

  it("stops before spending anything when the translation is not ready", async () => {
    const seed = await seedDubJob()
    await prisma.mediaTranslation.update({
      where: { id: seed.translation.id },
      data: { status: "PENDING" },
    })

    const dub = await runDub(seed)
    expect(dub.status).toBe("FAILED")
    expect(dub.error).toMatch(/translation is not ready/i)
  }, 120_000)

  it("stops when no voice settings were saved", async () => {
    const seed = await seedDubJob()
    await prisma.mediaDub.update({ where: { id: seed.dub.id }, data: { voiceProfiles: [] } })

    const dub = await runDub(seed)
    expect(dub.status).toBe("FAILED")
    expect(dub.error).toMatch(/voice settings/i)
  }, 120_000)
})

describe("dub worker: diagnostics", () => {
  it("keeps the full separator log on disk, not in the database", async () => {
    const seed = await seedDubJob()
    await runDub(seed)

    const logs = await readdir(path.join(storageRoot, "logs")).catch(() => [] as string[])
    expect(logs, "a log file per dub").toContain(`dub-${seed.dub.id}.log`)
  }, 120_000)

})

describe("dub worker: one separation at a time", () => {
  it("waits rather than starting a second one, and says why", async () => {
    /**
     * The guard that exists because of an observed kill: the separator reached
     * 2.28 GB while something else was running, and the kernel took it after
     * twenty minutes of correct work. Two at once on this machine is not slow,
     * it is fatal to one of them.
     */
    const seed = await seedDubJob()

    // Somebody else holds the machine's slot.
    await redis.set("arciin:separation:local", "another-worker", "EX", 60)

    const stages: string[] = []
    const watch = setInterval(() => {
      void prisma.mediaDub
        .findUnique({ where: { id: seed.dub.id }, select: { stage: true } })
        .then((row) => {
          if (row?.stage && !stages.includes(row.stage)) stages.push(row.stage)
        })
    }, 100)

    // Released shortly, so the job proceeds rather than timing out.
    setTimeout(() => void redis.del("arciin:separation:local"), 1200)

    const dub = await runDub(seed)
    clearInterval(watch)

    // It waited, and it said so in words a person can act on.
    expect(stages.some((s) => /waiting/i.test(s)), `stages seen: ${stages.join(" | ")}`).toBe(true)
    // And then it ran: waiting is not failing.
    expect(dub.status).not.toBe("FAILED")
  }, 120_000)

  it("frees the slot when the job fails", async () => {
    const seed = await seedDubJob()
    behaviour.separate = "throw-tool-error"

    await runDub(seed)

    // A crashed job that kept the lock would leave the machine permanently
    // unable to separate anything until someone noticed.
    expect(await redis.get("arciin:separation:local")).toBeNull()
  }, 120_000)
})
