import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_STEM_RETENTION_MS,
  getStems,
  putStems,
  stemCacheDir,
  stemCacheKey,
  sweepStemCache,
} from "../packages/media-ai/src/stem-cache"

/**
 * Keeping the expensive half of a dub across a retry.
 *
 * Separation of a twelve-minute video takes two and a half hours here and is
 * deterministic; synthesis afterwards takes minutes and is the part that
 * actually failed. Until this existed, a failure in the cheap stage deleted the
 * successful expensive one.
 *
 * Real files in a real temp directory, because every property worth asserting
 * is about the filesystem: that a half-written cache is not trusted, that a
 * crash leaves nothing usable behind, and that the disk is eventually reclaimed.
 */

const CHECKSUM = "a".repeat(64)
const MODEL = "htdemucs.yaml"

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "arciin-stems-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A source separation, as the worker would hand it over. */
async function fakeSeparation(dir: string, bytes = 2048) {
  await mkdir(dir, { recursive: true })
  const dialoguePath = path.join(dir, "src_(Vocals)_htdemucs.wav")
  const backgroundPath = path.join(dir, "background.wav")
  await writeFile(dialoguePath, Buffer.alloc(bytes, 1))
  await writeFile(backgroundPath, Buffer.alloc(bytes, 2))
  return { dialoguePath, backgroundPath, strategy: "separated" as const }
}

describe("stemCacheKey", () => {
  it("keys on the audio and the model, and nothing else", () => {
    /**
     * Not the language, not the voices, not the translation — none of those
     * change what the stems are. So an Arabic dub and a Spanish dub of one
     * video share a separation.
     */
    expect(stemCacheKey(CHECKSUM, MODEL)).toBe(stemCacheKey(CHECKSUM, MODEL))
    expect(stemCacheKey(CHECKSUM, "UVR-MDX-NET-Inst_HQ_3.onnx")).not.toBe(
      stemCacheKey(CHECKSUM, MODEL),
    )
    expect(stemCacheKey("b".repeat(64), MODEL)).not.toBe(stemCacheKey(CHECKSUM, MODEL))
  })

  it("produces a key that is safe as a directory name", () => {
    const key = stemCacheKey(CHECKSUM, "some/model with spaces.yaml")
    expect(key).not.toMatch(/[/\\ ]/)
  })
})

describe("getStems", () => {
  it("finds nothing when nothing has been cached", async () => {
    expect(await getStems(root, CHECKSUM, MODEL)).toBeNull()
  })

  it("returns a complete cached separation", async () => {
    const produced = await fakeSeparation(path.join(root, "work"))
    await putStems(root, CHECKSUM, MODEL, produced)

    const hit = await getStems(root, CHECKSUM, MODEL)
    expect(hit).not.toBeNull()
    expect(hit!.strategy).toBe("separated")
    expect(existsSync(hit!.dialoguePath)).toBe(true)
    expect(existsSync(hit!.backgroundPath)).toBe(true)
  })

  it("refuses a half-written cache", async () => {
    /**
     * The dangerous case. A truncated background stem would be mixed into a dub
     * silently, and the result is a track quietly missing its music — which
     * nobody would notice until they listened.
     */
    const dir = stemCacheDir(root, CHECKSUM, MODEL)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "dialogue.wav"), Buffer.alloc(2048))
    await writeFile(path.join(dir, "background.wav"), Buffer.alloc(0))

    expect(await getStems(root, CHECKSUM, MODEL)).toBeNull()
  })

  it("refuses a cache missing a file entirely", async () => {
    const dir = stemCacheDir(root, CHECKSUM, MODEL)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "dialogue.wav"), Buffer.alloc(2048))

    expect(await getStems(root, CHECKSUM, MODEL)).toBeNull()
  })
})

describe("putStems", () => {
  it("refuses to cache a result that was not really separated", async () => {
    /**
     * A "replaced" result is the original audio with the dialogue gone. Reusing
     * that as though it were a separation would destroy the music on every
     * later dub of the same video.
     */
    const produced = await fakeSeparation(path.join(root, "work"))
    const stored = await putStems(root, CHECKSUM, MODEL, {
      ...produced,
      strategy: "replaced",
    })

    expect(stored).toBeNull()
    expect(await getStems(root, CHECKSUM, MODEL)).toBeNull()
  })

  it("leaves no staging directory behind on success", async () => {
    const produced = await fakeSeparation(path.join(root, "work"))
    await putStems(root, CHECKSUM, MODEL, produced)

    const entries = await readdir(path.join(root, "cache", "stems"))
    // Written beside the destination and renamed in, so a reader sees the
    // directory either complete or absent — never mid-copy.
    expect(entries.some((e) => e.includes(".incoming-"))).toBe(false)
    expect(entries).toHaveLength(1)
  })

  it("does not overwrite an existing entry, and still returns it", async () => {
    const first = await fakeSeparation(path.join(root, "work-1"), 2048)
    await putStems(root, CHECKSUM, MODEL, first)
    const before = await stat(path.join(stemCacheDir(root, CHECKSUM, MODEL), "background.wav"))

    // A second job for the same audio finishing at the same time.
    const second = await fakeSeparation(path.join(root, "work-2"), 9999)
    const stored = await putStems(root, CHECKSUM, MODEL, second)

    expect(stored).not.toBeNull()
    const after = await stat(path.join(stemCacheDir(root, CHECKSUM, MODEL), "background.wav"))
    expect(after.size).toBe(before.size)
  })

  it("survives an unwritable destination without losing the dub", async () => {
    /**
     * Caching is an optimisation. The caller already has usable stems in its
     * work directory, so a cache failure must return null and let the job carry
     * on rather than throw.
     */
    const produced = await fakeSeparation(path.join(root, "work"))

    // A regular file standing where the storage root should be: mkdir fails
    // immediately with ENOTDIR, which is a deterministic stand-in for any
    // permission or disk problem.
    const blocked = path.join(root, "not-a-directory")
    await writeFile(blocked, "x")

    const stored = await putStems(blocked, CHECKSUM, MODEL, produced)
    expect(stored).toBeNull()
  })

  it("records what it stored", async () => {
    const produced = await fakeSeparation(path.join(root, "work"))
    await putStems(root, CHECKSUM, MODEL, produced)

    const meta = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(stemCacheDir(root, CHECKSUM, MODEL), "meta.json"), "utf8"),
      ),
    ) as { checksum: string; model: string; strategy: string }

    expect(meta.checksum).toBe(CHECKSUM)
    expect(meta.model).toBe(MODEL)
    expect(meta.strategy).toBe("separated")
  })
})

describe("sweepStemCache", () => {
  /** Backdate a directory so retention can be tested without waiting a week. */
  async function age(dir: string, ms: number) {
    const when = new Date(Date.now() - ms)
    await utimes(dir, when, when)
  }

  it("keeps a recent entry", async () => {
    const produced = await fakeSeparation(path.join(root, "work"))
    await putStems(root, CHECKSUM, MODEL, produced)

    const result = await sweepStemCache(root)
    expect(result.retained).toBe(1)
    expect(result.deleted).toBe(0)
    expect(await getStems(root, CHECKSUM, MODEL)).not.toBeNull()
  })

  it("deletes one past the retention window, and says how much it freed", async () => {
    const produced = await fakeSeparation(path.join(root, "work"), 4096)
    await putStems(root, CHECKSUM, MODEL, produced)
    await age(stemCacheDir(root, CHECKSUM, MODEL), DEFAULT_STEM_RETENTION_MS + 60_000)

    const result = await sweepStemCache(root)
    expect(result.deleted).toBe(1)
    // Half a gigabyte per video is not free, so the figure is worth reporting.
    expect(result.bytesRecovered).toBeGreaterThan(8000)
    expect(await getStems(root, CHECKSUM, MODEL)).toBeNull()
  })

  it("clears abandoned staging directories, which are as large as the real thing", async () => {
    const stray = path.join(root, "cache", "stems", `${CHECKSUM}-htdemucs.incoming-123-456`)
    await mkdir(stray, { recursive: true })
    await writeFile(path.join(stray, "dialogue.wav"), Buffer.alloc(4096))
    await age(stray, 60 * 60 * 1000)

    const result = await sweepStemCache(root)
    expect(result.deleted).toBe(1)
    expect(existsSync(stray)).toBe(false)
  })

  it("does not clear a staging directory that is still being written", async () => {
    const active = path.join(root, "cache", "stems", `${CHECKSUM}-htdemucs.incoming-999-1`)
    await mkdir(active, { recursive: true })

    const result = await sweepStemCache(root)
    expect(result.deleted).toBe(0)
  })

  it("has nothing to say about a storage root with no cache", async () => {
    const result = await sweepStemCache(path.join(root, "never-used"))
    expect(result).toEqual({ examined: 0, deleted: 0, retained: 0, bytesRecovered: 0 })
  })
})
