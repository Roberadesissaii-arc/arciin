import type { ComputerRoot } from "@/lib/api/computers"

/**
 * What a protected folder's status should actually say.
 *
 * `PROTECTED` records an intention — this folder is designated for backup — not
 * an outcome. Backup setup creates the root over a user session and it is
 * PROTECTED from that instant, whether or not any computer ever picks it up.
 * Rendering that as "Up to date" turned a designation into a guarantee: a
 * folder with 20,000 files on disk, nothing uploaded, and no local record on
 * the computer still read as fully backed up.
 *
 * The evidence is `acknowledgedAt` — the computer itself calling
 * `POST /backup/roots` with its sync grant after committing the root to its own
 * store. It is the only signal that is *stated* by the computer rather than
 * inferred by the server.
 *
 * `fileCount` is deliberately not consulted. An empty protected folder is
 * perfectly normal and must be able to read as protected and up to date with
 * zero files; inferring protection from contents is wrong in both directions,
 * which is the bug this replaces.
 */
export const UNACKNOWLEDGED_ROOT_LABEL = "Waiting for this computer"

/** A root no computer has claimed. */
export function isAwaitingComputer(
  root: Pick<ComputerRoot, "status" | "acknowledgedAt">,
): boolean {
  return root.status !== "DISABLED" && !root.acknowledgedAt
}

/** Profile-level health, for a computer with nothing unclaimed to qualify it. */
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
 * Status label for a single protected folder.
 *
 * An acknowledged root reports the computer's own health. That is as precise as
 * the protocol currently allows: the heartbeat's health is computed across the
 * whole profile, so it cannot say which individual root has finished
 * reconciling. Claiming per-root completion from it would be a fresh guess of
 * exactly the kind this change exists to remove.
 */
export function computerRootStatusLabel(
  root: Pick<ComputerRoot, "status" | "acknowledgedAt">,
  computerHealth?: string,
): string {
  if (root.status === "DISABLED") return "Disabled"
  if (isAwaitingComputer(root)) return UNACKNOWLEDGED_ROOT_LABEL
  switch (root.status) {
    case "SYNCING":
      return "Backing up"
    case "PAUSED":
      return "Paused"
    case "ERROR":
      return "Error"
    case "PROTECTED":
      return computerHealth ? plainHealthLabel(computerHealth) : "Up to date"
    default:
      return root.status
  }
}

/**
 * Whether a computer as a whole may be presented as up to date.
 *
 * A computer holding a root no computer has claimed is not up to date, however
 * healthy the profile row looks — that root is precisely the one nobody is
 * backing up.
 */
export function computerIsUpToDate(input: {
  health: string
  roots: Array<Pick<ComputerRoot, "status" | "acknowledgedAt">>
}): boolean {
  if (input.health !== "UP_TO_DATE") return false
  return !input.roots.some(isAwaitingComputer)
}

/** Status label for a whole computer, qualified by its roots. */
export function computerHealthLabel(input: {
  health: string
  roots: Array<Pick<ComputerRoot, "status" | "acknowledgedAt">>
}): string {
  if (input.health === "UP_TO_DATE" && !computerIsUpToDate(input)) {
    return UNACKNOWLEDGED_ROOT_LABEL
  }
  return plainHealthLabel(input.health)
}
