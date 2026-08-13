/**
 * Binary units (1024): B, KB, MB, GB, TB, PB.
 * - 0 / invalid → "0 B"
 * - whole units (B or integer) → no decimals
 * - scaled value ≥ 100 → 0 decimals
 * - otherwise 1 decimal (e.g. 12.4 GB, 465.1 GB)
 */
export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"] as const
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const size = value / 1024 ** exponent

  if (exponent === 0 || Number.isInteger(size)) {
    return `${Math.round(size)} ${units[exponent]}`
  }

  if (size >= 100) {
    return `${Math.round(size)} ${units[exponent]}`
  }

  return `${size.toFixed(1)} ${units[exponent]}`
}
