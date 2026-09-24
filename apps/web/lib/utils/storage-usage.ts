import type { StorageSettings } from "@/lib/types/models"

/**
 * How full the disk is — the filesystem's own figure.
 *
 * The dashboard used to divide Arciin's usage by the filesystem's size and
 * call it "disk capacity used", so a disk that was 90% full showed 0% because
 * everything else on it was invisible to the numerator. Settings was fixed to
 * use the filesystem numbers; this is the same fix for every other caller.
 * The legacy division is only a last resort for an API too old to send them.
 */
export function resolveStorageUsagePercent(storage: StorageSettings): number | null {
  if (storage.filesystemUsagePercent != null) {
    return Math.max(0, Math.min(100, Math.round(storage.filesystemUsagePercent)))
  }
  const total = resolveFilesystemTotalBytes(storage)
  const used = resolveFilesystemUsedBytes(storage)
  if (total && used != null) return Math.max(0, Math.min(100, Math.round((used / total) * 100)))

  let legacyTotal = storage.totalBytes ?? null
  if (legacyTotal == null && storage.availableBytes != null && storage.availableBytes >= 0) {
    const inferred = storage.usageBytes + storage.availableBytes
    if (inferred > 0) legacyTotal = inferred
  }
  if (legacyTotal != null && legacyTotal > 0) {
    return Math.min(100, Math.round((storage.usageBytes / legacyTotal) * 100))
  }
  return null
}

export function resolveFilesystemTotalBytes(storage: StorageSettings): number | null {
  const total = storage.filesystemTotalBytes ?? storage.totalBytes ?? null
  return total && total > 0 ? total : null
}

/** Everything on the disk, not just Arciin's files. */
export function resolveFilesystemUsedBytes(storage: StorageSettings): number | null {
  if (storage.filesystemUsedBytes != null) return storage.filesystemUsedBytes
  const total = resolveFilesystemTotalBytes(storage)
  const available = storage.filesystemAvailableBytes ?? storage.availableBytes ?? null
  if (total != null && available != null) return Math.max(0, total - available)
  return null
}
