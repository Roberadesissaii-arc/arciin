/**
 * Health for folder-based media connectors (Plex, Jellyfin).
 *
 * Dependency-free so the rule can be unit-tested on its own.
 */

export type ConnectorHealthState = "healthy" | "degraded" | "disconnected" | "error"

export type ConnectorHealth = {
  state: ConnectorHealthState
  /** One sentence a person can act on. Never contains an absolute path. */
  reason: string
}

/**
 * What "connected" is allowed to mean.
 *
 * These connectors are folder layouts, not API sessions: Arciin keeps a
 * `Plex`/`Jellyfin` folder in each media library and mirrors files into a
 * directory the media server scans. There is no provider URL or token to
 * probe, so health is judged on the part Arciin owns — whether that directory
 * tree is there and writable. The card used to say "Connected" in green right
 * above a warning that folders were missing; that combination cannot come out
 * of this function.
 */
export function computeConnectorHealth(input: {
  enabled: boolean
  displayName: string
  mirrorRootWritable: boolean
  folders: Array<{ libraryName: string; ready: boolean; onDisk: boolean }>
}): ConnectorHealth {
  const { enabled, displayName, mirrorRootWritable, folders } = input
  if (!enabled) {
    return {
      state: "disconnected",
      reason: `${displayName} folders are turned off. Uploads are not mirrored for ${displayName}.`,
    }
  }
  if (!mirrorRootWritable) {
    return {
      state: "error",
      reason: `The library folder ${displayName} scans cannot be written. Check that the storage drive is mounted and writable.`,
    }
  }
  if (folders.length === 0) {
    return {
      state: "degraded",
      reason: `No Videos, Images, or Music library exists for ${displayName} to use.`,
    }
  }
  const missingInArciin = folders.filter((f) => !f.ready).map((f) => f.libraryName)
  if (missingInArciin.length) {
    return {
      state: "degraded",
      reason: `${displayName} folder missing in ${missingInArciin.join(", ")}. Use Repair folders to recreate it.`,
    }
  }
  const missingOnDisk = folders.filter((f) => !f.onDisk).map((f) => f.libraryName)
  if (missingOnDisk.length) {
    return {
      state: "degraded",
      reason: `The ${displayName} folder for ${missingOnDisk.join(", ")} is missing on disk, so ${displayName} cannot see those files. Use Repair folders.`,
    }
  }
  return {
    state: "healthy",
    reason: `${displayName} folders are in place and new uploads are mirrored for ${displayName} to scan.`,
  }
}
