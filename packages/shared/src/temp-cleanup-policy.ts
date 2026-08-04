/**
 * Which temporary files a cleanup run may delete.
 *
 * Deleting user data is the most destructive thing this codebase does, so the
 * decision is a pure function with no filesystem access: every rule is
 * unit-testable, and the caller only ever deletes what this returns.
 *
 * The bias is deliberate — anything uncertain is kept. A retained stale file
 * costs disk; a wrongly deleted one costs a user's upload.
 */

/** Conservative default: a day is far longer than any upload takes. */
export const DEFAULT_TEMP_MAX_AGE_HOURS = 24

export type TempFileCandidate = {
  /** Absolute resolved path. */
  path: string
  /** Last modification time. */
  mtimeMs: number
  sizeBytes: number
  /** True when the path resolves outside the temp root (symlink escape). */
  escapesRoot?: boolean
}

export type TempCleanupDecision =
  | { deletable: true }
  | { deletable: false; reason: string }

export type TempCleanupOptions = {
  /** Resolved temp directory. Nothing outside it is ever touched. */
  tempRoot: string
  now: number
  maxAgeHours?: number
  /**
   * Paths belonging to uploads still in flight. Belt-and-braces: an in-flight
   * temp file is normally far younger than the age threshold anyway.
   */
  activePaths?: ReadonlySet<string>
}

/**
 * Resolve `.` and `..` segments.
 *
 * Hand-rolled rather than `node:path` because this module is also bundled for
 * the browser. Without it a prefix check would accept
 * `/…/temp/../objects/x.bin`, which starts with the temp root as a *string*
 * but escapes it as a *path*.
 */
function normalizePath(input: string): string {
  const isAbsolute = input.startsWith("/")
  const resolved: string[] = []

  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== "..") resolved.pop()
      else if (!isAbsolute) resolved.push("..")
      continue
    }
    resolved.push(segment)
  }

  return (isAbsolute ? "/" : "") + resolved.join("/")
}

function isWithinRoot(candidate: string, root: string): boolean {
  const normalizedRoot = normalizePath(root)
  const normalizedCandidate = normalizePath(candidate)
  // Compare on a path-segment boundary so "/tmp/arciin-evil" is not treated as
  // being inside "/tmp/arciin".
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  )
}

export function decideTempFile(
  candidate: TempFileCandidate,
  options: TempCleanupOptions,
): TempCleanupDecision {
  // Containment first: a path outside the temp root is never deletable, no
  // matter how old it looks.
  if (!isWithinRoot(candidate.path, options.tempRoot)) {
    return { deletable: false, reason: "outside temp root" }
  }

  if (candidate.escapesRoot) {
    return { deletable: false, reason: "symlink escapes temp root" }
  }

  if (options.activePaths?.has(candidate.path)) {
    return { deletable: false, reason: "belongs to an in-flight upload" }
  }

  const maxAgeMs = (options.maxAgeHours ?? DEFAULT_TEMP_MAX_AGE_HOURS) * 60 * 60 * 1000
  const age = options.now - candidate.mtimeMs

  if (age < maxAgeMs) {
    return { deletable: false, reason: "newer than the age threshold" }
  }

  // A future mtime means a clock skew or a file still being written.
  if (age < 0) {
    return { deletable: false, reason: "modification time is in the future" }
  }

  return { deletable: true }
}

export type TempCleanupPlan = {
  deletable: TempFileCandidate[]
  retained: Array<{ candidate: TempFileCandidate; reason: string }>
  bytesRecoverable: number
}

/** Partition candidates into what may be deleted and what is kept, with reasons. */
export function planTempCleanup(
  candidates: TempFileCandidate[],
  options: TempCleanupOptions,
): TempCleanupPlan {
  const deletable: TempFileCandidate[] = []
  const retained: Array<{ candidate: TempFileCandidate; reason: string }> = []

  for (const candidate of candidates) {
    const decision = decideTempFile(candidate, options)
    if (decision.deletable) deletable.push(candidate)
    else retained.push({ candidate, reason: decision.reason })
  }

  return {
    deletable,
    retained,
    bytesRecoverable: deletable.reduce((total, file) => total + file.sizeBytes, 0),
  }
}
