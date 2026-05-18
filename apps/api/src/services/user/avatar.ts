import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { apiConfig } from "@/config"

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"])
const MAX_BYTES = 2 * 1024 * 1024

export function avatarsDirectory() {
  return path.join(apiConfig.dataDir, "avatars")
}

export function avatarFilePath(userId: string, ext: string) {
  return path.join(avatarsDirectory(), `${userId}${ext}`)
}

export function avatarPublicPath(userId: string) {
  return `/api/auth/users/${userId}/avatar`
}

export function extensionFromMime(mime: string): string | null {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
      return ".jpg"
    case "image/png":
      return ".png"
    case "image/webp":
      return ".webp"
    case "image/gif":
      return ".gif"
    default:
      return null
  }
}

export async function saveUserAvatar(userId: string, buffer: Buffer, mimeType: string) {
  const ext = extensionFromMime(mimeType)
  if (!ext || !ALLOWED_EXT.has(ext)) {
    throw new Error("Use a JPEG, PNG, WebP, or GIF image.")
  }
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error("Profile image must be 2 MB or smaller.")
  }

  await mkdir(avatarsDirectory(), { recursive: true })

  for (const oldExt of ALLOWED_EXT) {
    await unlink(avatarFilePath(userId, oldExt)).catch(() => {})
  }

  const relative = path.join("avatars", `${userId}${ext}`)
  const absolute = path.join(apiConfig.dataDir, relative)
  await writeFile(absolute, buffer)

  return relative
}

export async function removeUserAvatarFiles(userId: string) {
  for (const ext of ALLOWED_EXT) {
    await unlink(avatarFilePath(userId, ext)).catch(() => {})
  }
}

export function resolveAvatarAbsolutePath(avatarPath: string | null | undefined) {
  if (!avatarPath) return null
  const absolute = path.isAbsolute(avatarPath)
    ? avatarPath
    : path.join(apiConfig.dataDir, avatarPath)
  return absolute
}
