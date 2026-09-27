/**
 * Wording for the storage-devices panel, kept pure so it can be tested.
 */

type Scan = {
  unmountedDevices?: Array<{ id: string }>
  volumes?: Array<{ id: string }>
  blockDisks?: Array<{ id: string }>
}

function ids(scan: Scan | undefined) {
  return new Set([
    ...(scan?.blockDisks ?? []).map((d) => `disk:${d.id}`),
    ...(scan?.unmountedDevices ?? []).map((d) => `part:${d.id}`),
    ...(scan?.volumes ?? []).map((v) => `vol:${v.id}`),
  ])
}

/**
 * What a Rescan found, compared with what was on screen before it.
 * "No new disks found." is an answer, not silence — a button that spins and
 * changes nothing reads as broken.
 */
export function describeRescan(before: Scan | undefined, after: Scan): { title: string; description?: string } {
  const prev = ids(before)
  const next = ids(after)
  const added = [...next].filter((id) => !prev.has(id))
  const removed = [...prev].filter((id) => !next.has(id))
  const addedDisks = added.filter((id) => id.startsWith("disk:")).length
  const addedParts = added.filter((id) => id.startsWith("part:") || id.startsWith("vol:")).length

  if (!added.length && !removed.length) {
    return { title: "No new disks found.", description: "The server reports the same storage devices as before." }
  }
  const parts: string[] = []
  if (addedDisks) parts.push(`${addedDisks} new disk${addedDisks === 1 ? "" : "s"}`)
  if (addedParts) parts.push(`${addedParts} new partition${addedParts === 1 ? "" : "s"} or volume${addedParts === 1 ? "" : "s"}`)
  if (removed.length) parts.push(`${removed.length} no longer detected`)
  return { title: "Storage devices refreshed.", description: `${parts.join(", ")}.` }
}

/**
 * Why "Transfer all files here" is disabled, in words. A disabled button with
 * no reason is the most common "it's broken" report there is.
 */
export function transferBlockedReason(input: {
  active: boolean
  pending: boolean
  hasTarget: boolean
  targetWritable: boolean
  selectedUnmounted: boolean
}): string | null {
  if (input.active || input.pending) return "A transfer is already running."
  if (input.selectedUnmounted && !input.hasTarget) {
    return "Mount this partition before transferring Arciin storage."
  }
  if (!input.hasTarget) return "Choose a mounted drive under Move files to."
  if (!input.targetWritable) {
    return "Arciin cannot write to that drive. Check its permissions on the server, then rescan."
  }
  return null
}
