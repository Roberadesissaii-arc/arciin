import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  compareFiles,
  copyTreeVerified,
  hashFile,
} from "../packages/storage/src/verify-copy"

/**
 * Storage migration copied with `cp(..., { force: false, errorOnExist: false })`,
 * which silently leaves any file already at the destination untouched.
 *
 * That is precisely the state an interrupted transfer leaves behind: the
 * half-written file from the moment the process died is treated as finished,
 * and the database is then pointed at it. The failure is silent, and it looks
 * like success.
 *
 * Disposable trees only. Nothing here touches the real storage root.
 */

let src: string
let dest: string

beforeEach(async () => {
  src = await mkdtemp(path.join(tmpdir(), "arciin-src-"))
  dest = await mkdtemp(path.join(tmpdir(), "arciin-dest-"))

  await mkdir(path.join(src, "nested", "deeper"), { recursive: true })
  await writeFile(path.join(src, "notes.txt"), "plain text\n")
  await writeFile(path.join(src, "empty.bin"), "")
  await writeFile(path.join(src, "photo (1).jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))
  await writeFile(path.join(src, "файл-日本語.md"), "# unicode\n")
  await writeFile(path.join(src, `${"a".repeat(180)}.txt`), "long name\n")
  await writeFile(path.join(src, "nested", "notes.txt"), "same name, different folder\n")
  // Large enough that a streamed hash matters and a truncation is obvious.
  await writeFile(path.join(src, "nested", "deeper", "big.bin"), Buffer.alloc(3 * 1024 * 1024, 7))
})

afterEach(async () => {
  await rm(src, { recursive: true, force: true })
  await rm(dest, { recursive: true, force: true })
})

describe("a first copy moves everything and proves it", () => {
  it("copies every file, byte for byte", async () => {
    const outcome = await copyTreeVerified(src, dest)
    expect(outcome.filesCopied).toBe(7)
    expect(outcome.filesReused).toBe(0)
    expect(outcome.filesReplaced).toBe(0)

    for (const rel of [
      "notes.txt",
      "empty.bin",
      "photo (1).jpg",
      "файл-日本語.md",
      "nested/notes.txt",
      "nested/deeper/big.bin",
    ]) {
      expect(await compareFiles(path.join(src, rel), path.join(dest, rel))).toBe("match")
    }
  })

  it("keeps files of the same name in different folders apart", async () => {
    await copyTreeVerified(src, dest)
    expect(await readFile(path.join(dest, "notes.txt"), "utf8")).toBe("plain text\n")
    expect(await readFile(path.join(dest, "nested", "notes.txt"), "utf8")).toBe(
      "same name, different folder\n",
    )
  })

  it("leaves the source untouched", async () => {
    const before = await hashFile(path.join(src, "nested", "deeper", "big.bin"))
    await copyTreeVerified(src, dest)
    expect(await hashFile(path.join(src, "nested", "deeper", "big.bin"))).toBe(before)
    expect((await stat(path.join(src, "notes.txt"))).size).toBeGreaterThan(0)
  })
})

describe("running it again is safe and cheap", () => {
  it("reuses what is already verified instead of recopying", async () => {
    await copyTreeVerified(src, dest)
    const second = await copyTreeVerified(src, dest)
    expect(second.filesReused).toBe(7)
    expect(second.filesCopied).toBe(0)
    expect(second.bytesCopied).toBe(0)
  })

  it("finishes a transfer that was interrupted partway", async () => {
    // Half the tree present, as if the process had died mid-run.
    await mkdir(path.join(dest, "nested"), { recursive: true })
    await writeFile(path.join(dest, "notes.txt"), "plain text\n")

    const outcome = await copyTreeVerified(src, dest)
    expect(outcome.filesReused).toBe(1)
    expect(outcome.filesCopied).toBe(6)
  })
})

describe("a file that is there but wrong is not mistaken for done", () => {
  it("replaces a truncated file", async () => {
    // The shape an interruption actually leaves: right name, wrong length.
    await writeFile(path.join(dest, "nested", "deeper", "big.bin"), Buffer.alloc(1024, 7)).catch(
      async () => {
        await mkdir(path.join(dest, "nested", "deeper"), { recursive: true })
        await writeFile(path.join(dest, "nested", "deeper", "big.bin"), Buffer.alloc(1024, 7))
      },
    )

    const outcome = await copyTreeVerified(src, dest)
    expect(outcome.filesReplaced).toBeGreaterThanOrEqual(1)
    expect(
      await compareFiles(
        path.join(src, "nested", "deeper", "big.bin"),
        path.join(dest, "nested", "deeper", "big.bin"),
      ),
    ).toBe("match")
  })

  it("replaces a file of the right length but the wrong contents", async () => {
    // Same size, different bytes: size alone would have called this done.
    await writeFile(path.join(dest, "notes.txt"), "plain TEXT\n")
    const outcome = await copyTreeVerified(src, dest)
    expect(outcome.filesReplaced).toBeGreaterThanOrEqual(1)
    expect(await readFile(path.join(dest, "notes.txt"), "utf8")).toBe("plain text\n")
  })

  it("tells the difference between missing, matching and wrong", async () => {
    const a = path.join(src, "notes.txt")
    expect(await compareFiles(a, path.join(dest, "notes.txt"))).toBe("missing")
    await copyTreeVerified(src, dest)
    expect(await compareFiles(a, path.join(dest, "notes.txt"))).toBe("match")
    await writeFile(path.join(dest, "notes.txt"), "tampered!")
    expect(await compareFiles(a, path.join(dest, "notes.txt"))).toBe("mismatch")
  })

  it("treats a zero-byte file as a real file, not as absent", async () => {
    await copyTreeVerified(src, dest)
    expect((await stat(path.join(dest, "empty.bin"))).size).toBe(0)
    expect(await compareFiles(path.join(src, "empty.bin"), path.join(dest, "empty.bin"))).toBe(
      "match",
    )
  })
})
