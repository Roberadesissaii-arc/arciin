import { createHash } from "node:crypto"
import fs from "node:fs"
import { mkdir, access, rename, stat, readdir } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import type { MultipartFile } from "@fastify/multipart"

import { apiConfig } from "@/config"

export function getStoragePaths(rootPath = apiConfig.dataDir) {
  return {
    rootPath,
    objectsDir: path.resolve(rootPath, "objects"),
    librariesDir: path.resolve(rootPath, "libraries"),
    thumbnailsDir: path.resolve(rootPath, "thumbnails"),
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

  const destination = fs.createWriteStream(tempPath)
  part.file.on("data", (chunk) => {
    hash.update(chunk)
    sizeBytes += chunk.length
  })

  await pipeline(part.file, destination)

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
  const normalizedExtension = extension.startsWith(".")
    ? extension.toLowerCase()
    : extension
      ? `.${extension.toLowerCase()}`
      : ""

  const objectKey = path.join(
    "objects",
    checksumSha256.slice(0, 2),
    checksumSha256.slice(2, 4),
    `${checksumSha256}${normalizedExtension}`
  )

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
