import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { apiConfig } from "@/config"

export type UploadLimitsConfig = {
  maxUploadSizeMb: number
  uploadRateLimitPerMinute: number
}

const CONFIG_DIR = "config"
const CONFIG_FILE = "upload-limits.json"
const MIN_MB = 1
const MAX_MB = 1_048_576 // 1 TiB
const DEFAULT_MAX_UPLOAD_SIZE_MB = 20 * 1024 // 20 GiB

function envDefaults(): UploadLimitsConfig {
  const maxUploadSizeMb = Number(process.env.MAX_UPLOAD_SIZE_MB || String(DEFAULT_MAX_UPLOAD_SIZE_MB))
  const uploadRateLimitPerMinute = Number(process.env.UPLOAD_RATE_LIMIT_PER_MINUTE || "500")
  return {
    maxUploadSizeMb:
      Number.isFinite(maxUploadSizeMb) && maxUploadSizeMb > 0
        ? maxUploadSizeMb
        : DEFAULT_MAX_UPLOAD_SIZE_MB,
    uploadRateLimitPerMinute:
      Number.isFinite(uploadRateLimitPerMinute) && uploadRateLimitPerMinute > 0
        ? uploadRateLimitPerMinute
        : 500,
  }
}

let runtime: UploadLimitsConfig = envDefaults()

function configPath() {
  return path.join(apiConfig.dataDir, CONFIG_DIR, CONFIG_FILE)
}

export async function initUploadLimits() {
  runtime = envDefaults()
  try {
    const raw = await readFile(configPath(), "utf8")
    const parsed = JSON.parse(raw) as Partial<UploadLimitsConfig>
    if (typeof parsed.maxUploadSizeMb === "number" && parsed.maxUploadSizeMb >= MIN_MB) {
      runtime.maxUploadSizeMb = Math.min(parsed.maxUploadSizeMb, MAX_MB)
    }
    if (
      typeof parsed.uploadRateLimitPerMinute === "number" &&
      parsed.uploadRateLimitPerMinute >= 1
    ) {
      runtime.uploadRateLimitPerMinute = parsed.uploadRateLimitPerMinute
    }
  } catch {
    /* use env defaults */
  }
}

export function getUploadLimits() {
  return {
    ...runtime,
    maxUploadSizeBytes: runtime.maxUploadSizeMb * 1024 * 1024,
    envMaxUploadSizeMb: envDefaults().maxUploadSizeMb,
  }
}

export async function setUploadLimits(patch: Partial<UploadLimitsConfig>) {
  const next = { ...runtime }
  if (patch.maxUploadSizeMb !== undefined) {
    if (!Number.isInteger(patch.maxUploadSizeMb) || patch.maxUploadSizeMb < MIN_MB) {
      throw new Error("maxUploadSizeMb must be a positive integer.")
    }
    next.maxUploadSizeMb = Math.min(patch.maxUploadSizeMb, MAX_MB)
  }
  if (patch.uploadRateLimitPerMinute !== undefined) {
    if (!Number.isInteger(patch.uploadRateLimitPerMinute) || patch.uploadRateLimitPerMinute < 1) {
      throw new Error("uploadRateLimitPerMinute must be at least 1.")
    }
    next.uploadRateLimitPerMinute = patch.uploadRateLimitPerMinute
  }
  runtime = next
  await mkdir(path.join(apiConfig.dataDir, CONFIG_DIR), { recursive: true })
  await writeFile(configPath(), `${JSON.stringify(runtime, null, 2)}\n`, "utf8")
  return getUploadLimits()
}

export class UploadTooLargeError extends Error {
  readonly code = "UPLOAD_TOO_LARGE"

  constructor(maxUploadSizeMb: number) {
    super(`File exceeds the upload size limit (${maxUploadSizeMb.toLocaleString()} MB).`)
    this.name = "UploadTooLargeError"
  }
}
