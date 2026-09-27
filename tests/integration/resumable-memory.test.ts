import { mkdtemp, open, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { sha256OfFile, writeChunkAt } from "../../apps/api/src/services/file-requests/resumable-storage"

/**
 * Memory stays flat regardless of file size.
 *
 * 128 MB is streamed through the chunk writer and read back through the
 * checksum, 64 KiB at a time. If either buffered the whole thing, the heap
 * would grow by roughly the file size; the bound below is a small fraction of
 * it.
 */
describe("resumable storage never buffers a whole file", () => {
  it("writes and hashes 128 MB with bounded heap growth", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arciin-resumable-mem-"))
    const file = path.join(dir, "x.partial")
    await (await open(file, "w")).close()
    const size = 128 * 1024 * 1024
    const piece = Buffer.alloc(64 * 1024, 7)
    async function* source() {
      for (let sent = 0; sent < size; sent += piece.length) yield piece
    }
    try {
      global.gc?.()
      const before = process.memoryUsage().heapUsed
      let peak = before
      const timer = setInterval(() => {
        peak = Math.max(peak, process.memoryUsage().heapUsed)
      }, 5)
      const written = await writeChunkAt({ file, offset: 0, expectedLength: size, body: source() })
      const digest = await sha256OfFile(file)
      clearInterval(timer)
      peak = Math.max(peak, process.memoryUsage().heapUsed)
      expect(written.bytes).toBe(size)
      expect(written.sha256).toBe(digest)
      expect((await stat(file)).size).toBe(size)
      expect(peak - before).toBeLessThan(32 * 1024 * 1024)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
