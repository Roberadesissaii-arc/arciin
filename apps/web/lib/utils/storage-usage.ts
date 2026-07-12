import type { StorageSettings } from "@/lib/types/models"

export function resolveStorageUsagePercent(storage: StorageSettings): number | null {
  let total = storage.totalBytes ?? null
  if (total == null && storage.availableBytes != null && storage.availableBytes >= 0) {
    const inferred = storage.usageBytes + storage.availableBytes
    if (inferred > 0) total = inferred
  }
  if (total != null && total > 0) {
    return Math.min(100, Math.round((storage.usageBytes / total) * 100))
  }
  return null
}
