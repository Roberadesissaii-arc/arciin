import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

import { apiConfig } from "@/config"
import { getLogsDirectory } from "@/services/logs/log-files"
import { trimLogFileToMaxSize } from "@/services/logs/log-rotation"

const UPLOAD_LOG = "upload.log"

export type UploadLogEntry = {
  level: "error" | "info"
  fileName: string
  message: string
  code?: string
  userId?: string
  uploadId?: string
  libraryId?: string
  folderId?: string
  details?: unknown
}

async function ensureLogDir() {
  const dir = getLogsDirectory()
  await mkdir(dir, { recursive: true })
  return path.join(dir, UPLOAD_LOG)
}

/** Append a structured line to data/arciin/logs/upload.log for later diagnosis. */
export async function appendUploadLog(entry: UploadLogEntry): Promise<void> {
  try {
    const filePath = await ensureLogDir()
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    })
    await appendFile(filePath, `${line}\n`, "utf8")
    await trimLogFileToMaxSize(filePath).catch(() => {})
  } catch {
    /* logging must not break uploads */
  }
}

export function uploadLogPathForDisplay() {
  return `${path.basename(apiConfig.dataDir)}/logs/${UPLOAD_LOG}`
}
