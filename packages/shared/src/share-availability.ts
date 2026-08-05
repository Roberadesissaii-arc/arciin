/**
 * Whether a share link may still serve its content.
 *
 * The resolver originally checked only revoked / expired / view-limit. It never
 * checked whether the shared *root* had since been deleted, so deleting a
 * folder did not stop its public link: the link kept listing and serving the
 * folder's surviving files to anyone holding the URL. One such share was live
 * in production.
 *
 * Deleting something is the most direct way a person revokes access to it. A
 * share that outlives the delete is a data-exposure bug, not a convenience.
 *
 * Pure so every rule is unit-testable without a database or Fastify.
 */

export type ShareAvailabilityCode =
  | "NOT_FOUND"
  | "REVOKED"
  | "EXPIRED"
  | "VIEW_LIMIT"

export type ShareAvailabilityInput = {
  exists: boolean
  revokedAt?: Date | null
  expiresAt?: Date | null
  maxViews?: number | null
  viewCount?: number
  resourceType?: "ASSET" | "ASSETS" | "FOLDER" | string
  /** The shared root's deletion state, when the share targets one. */
  target?: {
    deletedAt?: Date | null
    status?: string | null
  } | null
  now?: number
}

export type ShareAvailability =
  | { available: true }
  | { available: false; code: ShareAvailabilityCode }

/**
 * A deleted root is reported as NOT_FOUND rather than a distinct code: the
 * recipient should not be able to tell "this never existed" from "the owner
 * deleted it", which would leak the fact that content once existed.
 */
export function checkShareAvailability(input: ShareAvailabilityInput): ShareAvailability {
  if (!input.exists) return { available: false, code: "NOT_FOUND" }

  if (input.revokedAt) return { available: false, code: "REVOKED" }

  const now = input.now ?? Date.now()
  if (input.expiresAt && input.expiresAt.getTime() <= now) {
    return { available: false, code: "EXPIRED" }
  }

  if (input.maxViews != null && (input.viewCount ?? 0) >= input.maxViews) {
    return { available: false, code: "VIEW_LIMIT" }
  }

  // ASSETS shares carry many members and are filtered per-member downstream;
  // ASSET and FOLDER shares have a single root whose deletion ends the share.
  if (input.resourceType === "ASSET" || input.resourceType === "FOLDER") {
    const target = input.target
    if (!target) return { available: false, code: "NOT_FOUND" }
    if (target.deletedAt) return { available: false, code: "NOT_FOUND" }
    if (target.status === "DELETED") return { available: false, code: "NOT_FOUND" }
  }

  return { available: true }
}
