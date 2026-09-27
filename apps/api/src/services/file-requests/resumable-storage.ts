import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, rm, stat, truncate } from "node:fs/promises"
import path from "node:path"
import type { Readable } from "node:stream"

import { isSafeUploadId } from "@/services/file-requests/resumable-policy"
import { getStoragePaths } from "@/services/storage/local-storage"

/**
 * Disk side of resumable uploads.
 *
 * Partial files live in <storage>/temp/resumable/, never in a library, so an
 * incomplete transfer can never be mistaken for a finished file. The worker's
 * generic temp sweep only looks at top-level files in temp/, so it cannot
 * delete a partial out from under a live session; partials are removed by
 * session-aware cleanup instead.
 *
 * Every function here streams. A 2 GB file is never held in memory: chunks
 * are written piece by piece at their offset, and the final checksum is read
 * back through a stream.
 */

export function resumableDir(storageRoot: string): string {
  return path.join(getStoragePaths(storageRoot).tempDir, "resumable")
}

export function partialPath(storageRoot: string, uploadId: string): string {
  // The id is ours (a cuid) and checked anyway: it becomes a file name.
  if (!isSafeUploadId(uploadId)) throw new Error("Invalid upload id")
  return path.join(resumableDir(storageRoot), `${uploadId}.partial`)
}

export async function createPartialFile(storageRoot: string, uploadId: string): Promise<string> {
  await mkdir(resumableDir(storageRoot), { recursive: true })
  const file = partialPath(storageRoot, uploadId)
  const handle = await open(file, "a")
  await handle.close()
  return file
}

export class ChunkTooLargeError extends Error {}
export class ChunkTooShortError extends Error {}

/**
 * Write one chunk at an exact offset.
 *
 * Positional writes, not appends: retrying the same chunk overwrites the
 * same bytes instead of adding them again. The data is flushed to disk before
 * this returns, so an acknowledged chunk survives a crash.
 */
export async function writeChunkAt(input: {
  file: string
  offset: number
  expectedLength: number
  body: Readable | AsyncIterable<Buffer | Uint8Array>
}): Promise<{ bytes: number; sha256: string }> {
  const handle = await open(input.file, "r+")
  const hash = createHash("sha256")
  let written = 0
  try {
    for await (const piece of input.body) {
      const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece)
      if (written + buf.length > input.expectedLength) throw new ChunkTooLargeError()
      await handle.write(buf, 0, buf.length, input.offset + written)
      hash.update(buf)
      written += buf.length
    }
    if (written !== input.expectedLength) throw new ChunkTooShortError()
    await handle.sync()
  } finally {
    await handle.close()
  }
  return { bytes: written, sha256: hash.digest("hex") }
}

/** SHA-256 of a file, streamed. Memory use does not depend on file size. */
export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const piece of createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    hash.update(piece as Buffer)
  }
  return hash.digest("hex")
}

/**
 * Make the partial exactly `size` bytes long and report its real size.
 *
 * A rejected chunk may have written bytes past the acknowledged offset before
 * it was refused; those are never counted, and truncating to the declared
 * size removes them before the file is verified.
 */
export async function trimPartial(file: string, size: number): Promise<number> {
  await truncate(file, size)
  return (await stat(file)).size
}

export async function removePartial(storageRoot: string, uploadId: string): Promise<void> {
  if (!isSafeUploadId(uploadId)) return
  await rm(partialPath(storageRoot, uploadId), { force: true })
}
