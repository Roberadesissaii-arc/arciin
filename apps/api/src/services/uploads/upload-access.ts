import type { Prisma } from "@prisma/client"

/**
 * One authorization policy for every upload-session read path.
 *
 * `GET /uploads` previously ran an unscoped `findMany`, so any authenticated
 * principal — including VIEWER and any API key holding only `uploads:create` —
 * could enumerate the 100 most recent uploads instance-wide, with original
 * filenames. `GET /uploads/:id` had no ownership check at all, while the
 * sibling cancel/complete routes did. This module is the single place that
 * decides, so those routes cannot drift apart again.
 *
 * Pure: takes a principal, returns a Prisma filter or a denial. No database,
 * no Fastify, so every rule is unit-testable.
 */

export type UploadPrincipalRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"

export type UploadPrincipal = {
  userId: string
  role: UploadPrincipalRole
  /** Null for a browser session; the key's scopes for an API-key request. */
  apiKeyScopes: string[] | null
}

/**
 * Scopes that grant *reading* upload history.
 *
 * `uploads:create` is deliberately absent: permission to upload is not
 * permission to read what everyone else uploaded. `admin` is accepted because
 * the existing `scopeAllows` helper treats it as a superscope elsewhere.
 */
export const UPLOAD_READ_SCOPES = ["assets:read", "activity:read", "admin"] as const

/** Roles that may see uploads belonging to other users. */
const INSTANCE_WIDE_ROLES: UploadPrincipalRole[] = ["OWNER", "ADMIN"]

export type UploadAccessDecision =
  | { allowed: true; scope: "instance" | "own"; where: Prisma.UploadSessionWhereInput }
  | { allowed: false; reason: "missing_scope" }

function hasReadScope(scopes: string[] | null): boolean {
  if (!scopes) return true // Session principal — role decides instead.
  return scopes.some((scope) => (UPLOAD_READ_SCOPES as readonly string[]).includes(scope))
}

/**
 * Decide what a principal may read.
 *
 * VIEWER is granted **own uploads only**, matching the rest of the product:
 * VIEWER is a read-only role that can already list assets, so denying its own
 * upload history outright would be inconsistent — but it never sees another
 * user's rows.
 *
 * An API key is additionally capped by its own scopes and never exceeds the
 * owning user's role, so an API key issued by a MEMBER cannot read
 * instance-wide even if it carries `assets:read`.
 */
export function resolveUploadAccess(principal: UploadPrincipal): UploadAccessDecision {
  if (!hasReadScope(principal.apiKeyScopes)) {
    return { allowed: false, reason: "missing_scope" }
  }

  const instanceWide = INSTANCE_WIDE_ROLES.includes(principal.role)

  return instanceWide
    ? { allowed: true, scope: "instance", where: {} }
    : { allowed: true, scope: "own", where: { userId: principal.userId } }
}

/**
 * Filter for listing. Merged with any caller filter so a caller-supplied
 * condition can never widen the authorized set.
 */
export function uploadListWhere(
  principal: UploadPrincipal,
  extra?: Prisma.UploadSessionWhereInput,
): Prisma.UploadSessionWhereInput | null {
  const decision = resolveUploadAccess(principal)
  if (!decision.allowed) return null

  // AND, never spread: an `extra` carrying its own `userId` cannot override the
  // ownership constraint.
  return extra ? { AND: [decision.where, extra] } : decision.where
}

/**
 * Whether a principal may read one specific session.
 *
 * Callers must return **404**, not 403, when this is false: a 403 confirms the
 * id exists and turns the endpoint into an existence oracle.
 */
export function canReadUploadSession(
  principal: UploadPrincipal,
  session: { userId: string },
): boolean {
  const decision = resolveUploadAccess(principal)
  if (!decision.allowed) return false
  return decision.scope === "instance" || session.userId === principal.userId
}

/** Mutating an upload (cancel/complete) is always owner-or-admin. */
export function canMutateUploadSession(
  principal: UploadPrincipal,
  session: { userId: string },
): boolean {
  return (
    session.userId === principal.userId || INSTANCE_WIDE_ROLES.includes(principal.role)
  )
}
