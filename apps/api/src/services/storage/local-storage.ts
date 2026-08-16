import { createHash } from "node:crypto"
import fs from "node:fs"
import { mkdir, access, rename, stat, readdir, statfs } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import type { MultipartFile } from "@fastify/multipart"
import { buildObjectKey } from "@arciin/storage"

import { apiConfig } from "@/config"
import { getUploadLimits, UploadTooLargeError } from "@/services/config/upload-limits"

export function getStoragePaths(rootPath = apiConfig.dataDir) {
  return {
    rootPath,
    objectsDir: path.resolve(rootPath, "objects"),
    librariesDir: path.resolve(rootPath, "libraries"),
    thumbnailsDir: path.resolve(rootPath, "thumbnails"),
    /** Generated Canvas illustrations, addressed by a hash of their description. */
    illustrationsDir: path.resolve(rootPath, "illustrations"),
    tempDir: path.resolve(rootPath, "temp"),
    logsDir: path.resolve(rootPath, "logs"),
  }
}

export async function ensureStorageDirectories(rootPath = apiConfig.dataDir) {
  const storagePaths = getStoragePaths(rootPath)

  await Promise.all(
    Object.values(storagePaths).map((directory) =>
      mkdir(directory, {
        recursive: true,
      })
    )
  )
}

export function sanitizeFilename(filename: string) {
  return filename
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
}

export async function writeMultipartToTemp(
  part: MultipartFile,
  rootPath = apiConfig.dataDir
) {
  const storagePaths = getStoragePaths(rootPath)

  await ensureStorageDirectories(rootPath)

  const extension = path.extname(part.filename || "").toLowerCase()
  const tempName = `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`
  const tempPath = path.join(storagePaths.tempDir, tempName)
  const hash = createHash("sha256")
  let sizeBytes = 0

  const maxBytes = getUploadLimits().maxUploadSizeBytes
  const destination = fs.createWriteStream(tempPath)
  let rejected: UploadTooLargeError | null = null

  part.file.on("data", (chunk) => {
    if (rejected) return
    sizeBytes += chunk.length
    if (sizeBytes > maxBytes) {
      rejected = new UploadTooLargeError(getUploadLimits().maxUploadSizeMb)
      part.file.destroy(rejected)
      destination.destroy(rejected)
      return
    }
    hash.update(chunk)
  })

  try {
    await pipeline(part.file, destination)
  } catch (err) {
    if (rejected) throw rejected
    throw err
  }

  if (rejected) throw rejected

  return {
    tempPath,
    checksumSha256: hash.digest("hex"),
    sizeBytes,
  }
}

export function createObjectStoragePath(
  checksumSha256: string,
  extension: string,
  rootPath = apiConfig.dataDir
) {
  // The layout itself lives in @arciin/storage: the E2E seeder plants fixture
  // bytes where the API will look for them, and the two must not be able to
  // drift apart. Same derivation as before, one definition instead of two.
  const objectKey = buildObjectKey(checksumSha256, extension)

  return {
    objectKey,
    physicalPath: path.join(rootPath, objectKey),
  }
}

export async function moveTempToObject(tempPath: string, destinationPath: string) {
  await mkdir(path.dirname(destinationPath), {
    recursive: true,
  })

  try {
    await access(destinationPath)
    return destinationPath
  } catch {
    await rename(tempPath, destinationPath)
    return destinationPath
  }
}

export async function removeTempFile(tempPath: string) {
  try {
    await fs.promises.unlink(tempPath)
  } catch {
    return
  }
}

export async function assertStorageWritable(rootPath: string) {
  try {
    await access(rootPath, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function probeStorageRoot(rootPath: string) {
  let writable = false
  let totalBytes: number | null = null
  let availableBytes: number | null = null

  try {
    await access(rootPath, fs.constants.R_OK)
    writable = await assertStorageWritable(rootPath)
    const filesystemStats = await statfs(rootPath)
    totalBytes = Number(filesystemStats.bsize * filesystemStats.blocks)
    availableBytes = Number(filesystemStats.bsize * filesystemStats.bavail)
  } catch {
    writable = false
  }

  return { writable, totalBytes, availableBytes }
}

/** Prefer tracked object bytes when a directory walk returns zero (wrong path, permissions). */
export async function resolveStorageUsageBytes(
  storageRoot: string,
  trackedBytes: number,
): Promise<number> {
  const directoryBytes = await directoryUsageBytes(storageRoot)
  return Math.max(directoryBytes, trackedBytes)
}

export async function directoryUsageBytes(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
    })

    const nested = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name)

        if (entry.isDirectory()) {
          return directoryUsageBytes(entryPath)
        }

        const fileStat = await stat(entryPath)
        return Number(fileStat.size)
      })
    )

    return nested.reduce((total, value) => total + value, 0)
  } catch {
    return 0
  }
}
