/** Minimum bar width (%) so near-zero usage is still visible on the track. */
export const STORAGE_PROGRESS_MIN_VISIBLE = 2

export function storageProgressBarValue(usagePercent: number | null): number | null {
  if (usagePercent == null) return null
  if (usagePercent <= 0) return STORAGE_PROGRESS_MIN_VISIBLE
  return Math.min(100, usagePercent)
}

export function storageUsageLabel(usagePercent: number | null): string {
  if (usagePercent == null) return "Capacity not reported"
  if (usagePercent === 0) return "Initialized · 0%"
  return `${usagePercent}%`
}
