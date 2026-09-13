import {
  BACKUP_PATH_DEPTH_MAX,
  BACKUP_PATH_SEGMENT_MAX,
  BACKUP_RELATIVE_PATH_MAX,
} from "@arciin/config"

const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
])

export class BackupPathError extends Error {
  constructor(
    public readonly code: "PATH_INVALID" | "PATH_TOO_LONG" | "PATH_TRAVERSAL",
    message: string,
  ) {
    super(message)
    this.name = "BackupPathError"
  }
}

function isWindowsDriveAbsolute(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value)
}

function isUncAbsolute(value: string): boolean {
  return value.startsWith("\\\\") || value.startsWith("//")
}

/**
 * Normalize a client-supplied relative source path into a logical `/` path.
 *
 * The Linux server never uses this string as a host filesystem path.
 */
export function normalizeBackupRelativePath(input: string): string {
  if (typeof input !== "string") {
    throw new BackupPathError("PATH_INVALID", "Relative path is required.")
  }
  if (input.includes("\0")) {
    throw new BackupPathError("PATH_INVALID", "Relative path contains a NUL byte.")
  }

  const trimmed = input.normalize("NFC").trim()
  if (!trimmed || trimmed === "." || trimmed === "./") {
    return ""
  }
  if (trimmed.length > BACKUP_RELATIVE_PATH_MAX) {
    throw new BackupPathError("PATH_TOO_LONG", "Relative path is too long.")
  }
  if (isWindowsDriveAbsolute(trimmed) || isUncAbsolute(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new BackupPathError("PATH_TRAVERSAL", "Absolute paths are not allowed.")
  }

  const segments = trimmed.split(/[\\/]+/).filter((part) => part.length > 0)
  if (segments.length > BACKUP_PATH_DEPTH_MAX) {
    throw new BackupPathError("PATH_TOO_LONG", "Folder depth exceeds the limit.")
  }

  const safe: string[] = []
  for (const raw of segments) {
    const original = raw.normalize("NFC")
    if (original === "..") {
      throw new BackupPathError("PATH_TRAVERSAL", "Parent-directory segments are not allowed.")
    }
    // Windows trailing-dot/space names, not parent-directory segments.
    const segment = original.replace(/[. ]+$/g, "")
    if (!segment || segment === ".") {
      throw new BackupPathError("PATH_INVALID", "Empty path segments are not allowed.")
    }
    if (segment === "..") {
      throw new BackupPathError("PATH_TRAVERSAL", "Parent-directory segments are not allowed.")
    }
    if (segment.includes(":") || segment.includes("*") || segment.includes("?") || segment.includes("\"") || segment.includes("<") || segment.includes(">") || segment.includes("|")) {
      throw new BackupPathError("PATH_INVALID", "Path segment contains reserved characters.")
    }
    if (segment.length > BACKUP_PATH_SEGMENT_MAX) {
      throw new BackupPathError("PATH_TOO_LONG", "A path segment is too long.")
    }
    const reserved = segment.split(".")[0]?.toLowerCase() ?? ""
    if (WINDOWS_RESERVED.has(reserved)) {
      throw new BackupPathError("PATH_INVALID", "Reserved Windows names cannot be used as path segments.")
    }
    safe.push(segment)
  }

  return safe.join("/")
}

export function backupPathParent(relativePath: string): string {
  const normalized = normalizeBackupRelativePath(relativePath)
  const index = normalized.lastIndexOf("/")
  return index === -1 ? "" : normalized.slice(0, index)
}

export function backupPathBasename(relativePath: string): string {
  const normalized = normalizeBackupRelativePath(relativePath)
  const index = normalized.lastIndexOf("/")
  return index === -1 ? normalized : normalized.slice(index + 1)
}

export function isBackupPathInside(child: string, parent: string): boolean {
  const left = normalizeBackupRelativePath(child)
  const right = normalizeBackupRelativePath(parent)
  if (!right) return true
  return left === right || left.startsWith(`${right}/`)
}
