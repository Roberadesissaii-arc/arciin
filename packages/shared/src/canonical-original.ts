/**
 * Whether a stored original is actually usable for processing.
 *
 * Content-addressed reuse used to trust a StorageObject row alone. A leftover
 * row whose bytes had vanished still matched the checksum, so Computer Backup
 * deleted the freshly uploaded temp file and pointed the new asset at a ghost.
 * The worker then failed with "Original file missing on disk."
 *
 * Size must match: an empty placeholder or a truncated leftover is not the
 * original, even if the path exists.
 */
export type CanonicalOriginalPresence = {
  exists: boolean
  isFile: boolean
  sizeBytes: number
}

export function canonicalOriginalIsUsable(
  presence: CanonicalOriginalPresence,
  expectedSizeBytes: number,
): boolean {
  if (!presence.exists || !presence.isFile) return false
  if (!Number.isFinite(expectedSizeBytes) || expectedSizeBytes <= 0) return false
  return presence.sizeBytes === expectedSizeBytes
}
