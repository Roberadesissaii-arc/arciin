import { createReadStream } from "node:fs"
import { stat, writeFile } from "node:fs/promises"
import readline from "node:readline"

/** Keep log files under the UI tail limit (see log-files MAX_FILE_BYTES). */
export const DEFAULT_MAX_LOG_FILE_BYTES = 1_800_000

function lineByteLength(line: string) {
  return Buffer.byteLength(line, "utf8") + 1
}

/**
 * Drops oldest lines until the file is at most maxBytes.
 * Returns true if the file was trimmed.
 */
export async function trimLogFileToMaxSize(
  filePath: string,
  maxBytes = DEFAULT_MAX_LOG_FILE_BYTES,
): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => null)
  if (!fileStat?.isFile() || fileStat.size <= maxBytes) {
    return false
  }

  const kept: string[] = []
  let totalBytes = 0

  const stream = createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of rl) {
    kept.push(line)
    totalBytes += lineByteLength(line)
    while (totalBytes > maxBytes && kept.length > 0) {
      const removed = kept.shift()!
      totalBytes -= lineByteLength(removed)
    }
  }

  const marker = `# [${new Date().toISOString()}] Older log lines removed (file exceeded ${Math.round(maxBytes / 1024)} KB).`
  const body = kept.length > 0 ? `${kept.join("\n")}\n` : ""
  await writeFile(filePath, `${marker}\n${body}`, "utf8")
  return true
}
