import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

/**
 * Copying storage so that "already there" never means "assume correct".
 *
 * The migration used `cp(..., { force: false, errorOnExist: false })`, which
 * silently leaves any file already present at the destination untouched. That
 * is exactly the state an interrupted transfer leaves behind: a half-written
 * file from the moment the process died is treated as done, and the database
 * is then pointed at it. The failure is silent and the original is gone from
 * view even though it is still on disk.
 *
 * Every file is now accounted for. A destination file is reused only when its
 * size and SHA-256 match the source; otherwise it is rewritten. Hashing is
 * streamed, so a large video costs a constant amount of memory.
 */

export type CopyOutcome = {
  filesCopied: number
  filesReused: number
  filesReplaced: number
  bytesCopied: number
}

/** Streamed so file size does not become memory usage. */
export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  await pipeline(createReadStream(filePath), hash)
  return hash.digest("hex")
}

export type FileVerdict = "missing" | "match" | "mismatch"

/**
 * Whether a destination file can be trusted as a copy of the source.
 *
 * Size is checked first because it is nearly free and settles the common
 * interrupted-write case without reading either file.
 */
export async function compareFiles(src: string, dest: string): Promise<FileVerdict> {
  let destStat
  try {
    destStat = await stat(dest)
  } catch {
    return "missing"
  }
  const srcStat = await stat(src)
  if (srcStat.size !== destStat.size) return "mismatch"
  if (srcStat.size === 0) return "match"

  const [a, b] = await Promise.all([hashFile(src), hashFile(dest)])
  return a === b ? "match" : "mismatch"
}

/**
 * Copy a tree, verifying every file.
 *
 * Resumable by construction: a file already present and verified is left
 * alone, so a second run after an interruption does the remaining work rather
 * than starting over, and a partial file is replaced rather than trusted.
 */
export async function copyTreeVerified(
  srcDir: string,
  destDir: string,
  options: { onFile?: (relativePath: string, verdict: FileVerdict) => void } = {},
): Promise<CopyOutcome> {
  const outcome: CopyOutcome = {
    filesCopied: 0,
    filesReused: 0,
    filesReplaced: 0,
    bytesCopied: 0,
  }

  await mkdir(destDir, { recursive: true })

  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(path.join(srcDir, relative), { withFileTypes: true })
    for (const entry of entries) {
      const rel = path.join(relative, entry.name)
      const from = path.join(srcDir, rel)
      const to = path.join(destDir, rel)

      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true })
        await walk(rel)
        continue
      }
      // Symlinks and device nodes are not part of the object store; copying
      // them blindly would be a way to write outside the destination root.
      if (!entry.isFile()) continue

      const verdict = await compareFiles(from, to)
      options.onFile?.(rel, verdict)

      if (verdict === "match") {
        outcome.filesReused += 1
        continue
      }

      await mkdir(path.dirname(to), { recursive: true })
      const { copyFile } = await import("node:fs/promises")
      await copyFile(from, to)

      // Prove the copy, rather than trusting that it returned without error.
      const after = await compareFiles(from, to)
      if (after !== "match") {
        throw new Error(`Copy of ${rel} could not be verified at the destination.`)
      }

      const size = (await stat(from)).size
      outcome.bytesCopied += size
      if (verdict === "mismatch") outcome.filesReplaced += 1
      else outcome.filesCopied += 1
    }
  }

  await walk("")
  return outcome
}
