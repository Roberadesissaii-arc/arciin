import type { ComputerRoot } from "@/lib/api/computers"

/**
 * What a protected folder's status should actually say.
 *
 * `PROTECTED` records an intention — this folder is designated for backup — not
 * an outcome. A root is created the moment backup setup posts it, and it keeps
 * that status whether or not the computer ever picked it up. Rendering it as
 * "Up to date" turned a designation into a guarantee: a folder with 20,000
 * files on disk, nothing uploaded, and no local root on the computer at all
 * still read as fully backed up.
 *
 * `lastSyncAt` is the one piece of evidence the server only writes after real
 * sync work has been recorded for the root, so it is what separates "we intend
 * to back this up" from "this is backed up".
 *
 * This deliberately does not claim the computer has *acknowledged* the root.
 * The protocol has no such signal: SyncRoot records `status`, `fileCount`,
 * `byteCount` and `lastSyncAt`, and nothing that distinguishes "created on the
 * server" from "registered by the client". Closing that properly needs a
 * Desktop protocol change and is out of scope here. What this does is refuse to
 * claim more than the data supports: whether anything has ever synced.
 */
export const NEVER_SYNCED_ROOT_LABEL = "Waiting for this computer"

/** A root that is designated protected but has never completed a sync. */
export function isAwaitingFirstSync(root: Pick<ComputerRoot, "status" | "lastSyncAt">): boolean {
  return root.status === "PROTECTED" && !root.lastSyncAt
}

/**
 * Status label for a single protected folder.
 *
 * Callers that only have a profile-level health (`UP_TO_DATE`, `OFFLINE`, …)
 * should keep using `backupHealthLabel`; this is for per-root display.
 */
export function computerRootStatusLabel(
  root: Pick<ComputerRoot, "status" | "lastSyncAt">,
): string {
  if (isAwaitingFirstSync(root)) return NEVER_SYNCED_ROOT_LABEL
  switch (root.status) {
    case "PROTECTED":
      return "Up to date"
    case "SYNCING":
      return "Backing up"
    case "PAUSED":
      return "Paused"
    case "ERROR":
      return "Error"
    case "DISABLED":
      return "Disabled"
    default:
      return root.status
  }
}

/** Profile-level health, for a computer with no unsynced roots to qualify it. */
function plainHealthLabel(health: string): string {
  switch (health) {
    case "UP_TO_DATE":
      return "Up to date"
    case "SYNCING":
      return "Backing up"
    case "PAUSED":
      return "Paused"
    case "OFFLINE":
      return "Offline"
    case "ERROR":
      return "Error"
    case "DISABLED":
      return "Disabled"
    default:
      return health
  }
}

/**
 * Whether a computer as a whole may be presented as up to date.
 *
 * A computer with a root that has never synced is not up to date, however
 * healthy the profile row looks — the profile's own `lastSyncAt` is refreshed
 * by activity on *any* root, so it cannot speak for a root that has never run.
 */
export function computerIsUpToDate(input: {
  health: string
  roots: Array<Pick<ComputerRoot, "status" | "lastSyncAt">>
}): boolean {
  if (input.health !== "UP_TO_DATE") return false
  return !input.roots.some(isAwaitingFirstSync)
}

/** Status label for a whole computer, qualified by its roots. */
export function computerHealthLabel(input: {
  health: string
  roots: Array<Pick<ComputerRoot, "status" | "lastSyncAt">>
}): string {
  if (input.health === "UP_TO_DATE" && !computerIsUpToDate(input)) {
    return NEVER_SYNCED_ROOT_LABEL
  }
  return plainHealthLabel(input.health)
}
