import { createReadStream } from "node:fs"
import { access, readdir, stat } from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"

import { apiConfig } from "@/config"
import { getStoragePaths } from "@/services/storage/local-storage"

const LOG_NAME_PATTERN = /^[\w.-]+\.log(\.\d+)?$/
const MAX_TAIL_LINES = 500
const MAX_FILE_BYTES = 2 * 1024 * 1024

export type LogFileEntry = {
  name: string
  sizeBytes: number
  modifiedAt: string
  source: "api" | "worker" | "other"
}

function resolveLogSource(filename: string): LogFileEntry["source"] {
  if (filename.startsWith("api")) return "api"
  if (filename.startsWith("worker")) return "worker"
  return "other"
}

function assertSafeLogFilename(filename: string) {
  if (!LOG_NAME_PATTERN.test(filename) || filename.includes("..") || filename.includes("/")) {
    throw new Error("INVALID_LOG_FILE")
  }
}

export function getLogsDirectory() {
  return getStoragePaths(apiConfig.dataDir).logsDir
}

/** Safe display path for UI (no absolute server paths). */
export function getLogsDisplayPath() {
  const dataBase = path.basename(apiConfig.dataDir)
  return `${dataBase}/logs`
}

export async function listLogFiles(): Promise<LogFileEntry[]> {
  const logsDir = getLogsDirectory()
  await access(logsDir).catch(() => {
    throw new Error("LOGS_DIR_UNAVAILABLE")
  })

  const names = await readdir(logsDir)
  const files = await Promise.all(
    names.map(async (name) => {
      if (!LOG_NAME_PATTERN.test(name)) return null
      const filePath = path.join(logsDir, name)
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) return null
      return {
        name,
        sizeBytes: Number(fileStat.size),
        modifiedAt: fileStat.mtime.toISOString(),
        source: resolveLogSource(name),
      } satisfies LogFileEntry
    }),
  )

  return files
    .filter((entry): entry is LogFileEntry => entry !== null)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export async function tailLogFile(filename: string, lines = 200): Promise<string[]> {
  assertSafeLogFilename(filename)
  const logsDir = getLogsDirectory()
  const logsResolved = path.resolve(logsDir)
  const resolved = path.resolve(logsResolved, filename)
  if (!resolved.startsWith(`${logsResolved}${path.sep}`)) {
    throw new Error("INVALID_LOG_FILE")
  }

  const fileStat = await stat(resolved)
  if (!fileStat.isFile()) {
    throw new Error("LOG_FILE_NOT_FOUND")
  }
  if (fileStat.size > MAX_FILE_BYTES) {
    throw new Error("LOG_FILE_TOO_LARGE")
  }

  const limit = Math.min(MAX_TAIL_LINES, Math.max(1, lines))
  const collected: string[] = []

  const stream = createReadStream(resolved, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of rl) {
    collected.push(line)
    if (collected.length > limit) {
      collected.shift()
    }
  }

  return collected
}
