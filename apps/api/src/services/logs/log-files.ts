import { createReadStream } from "node:fs"
import { access, readdir, stat } from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"

import { apiConfig } from "@/config"
import {
  DEFAULT_MAX_LOG_FILE_BYTES,
  trimLogFileToMaxSize,
} from "@/services/logs/log-rotation"
import { getStoragePaths } from "@/services/storage/local-storage"

const LOG_NAME_PATTERN = /^[\w.-]+\.log(\.\d+)?$/
const MAX_TAIL_LINES = 500
/** Max size before tail refuses to read (after auto-trim attempt). */
const MAX_FILE_BYTES = 2 * 1024 * 1024

function maxLogBytesFromEnv() {
  const raw = Number(process.env.LOG_MAX_FILE_BYTES || String(DEFAULT_MAX_LOG_FILE_BYTES))
  return Number.isFinite(raw) && raw > 10_000 ? Math.min(raw, MAX_FILE_BYTES - 64_000) : DEFAULT_MAX_LOG_FILE_BYTES
}

export type LogFileEntry = {
  name: string
  sizeBytes: number
  modifiedAt: string
  source: "api" | "worker" | "other"
}

function resolveLogSource(filename: string): LogFileEntry["source"] {
  if (filename.startsWith("api")) return "api"
  if (filename.startsWith("worker")) return "worker"
  if (filename.startsWith("upload")) return "other"
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

/** Trim every log in the logs directory that exceeds the size cap. */
export async function trimOversizedLogFiles(): Promise<number> {
  const maxBytes = maxLogBytesFromEnv()
  const logsDir = getLogsDirectory()
  let trimmed = 0
  try {
    const files = await listLogFiles()
    for (const file of files) {
      if (file.sizeBytes <= maxBytes) continue
      const ok = await trimLogFileToMaxSize(path.join(logsDir, file.name), maxBytes)
      if (ok) trimmed += 1
    }
  } catch {
    /* best effort */
  }
  return trimmed
}

export async function tailLogFile(filename: string, lines = 200): Promise<string[]> {
  assertSafeLogFilename(filename)
  const logsDir = getLogsDirectory()
  const logsResolved = path.resolve(logsDir)
  const resolved = path.resolve(logsResolved, filename)
  if (!resolved.startsWith(`${logsResolved}${path.sep}`)) {
    throw new Error("INVALID_LOG_FILE")
  }

  let fileStat = await stat(resolved)
  if (!fileStat.isFile()) {
    throw new Error("LOG_FILE_NOT_FOUND")
  }

  const maxRetained = maxLogBytesFromEnv()
  if (fileStat.size > maxRetained) {
    await trimLogFileToMaxSize(resolved, maxRetained)
    fileStat = await stat(resolved)
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
