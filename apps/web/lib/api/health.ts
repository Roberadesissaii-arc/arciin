import { fetchApi } from "@/lib/api/client"
import type { HealthStatus } from "@/lib/types/models"

const clientApiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"

/** What the public `/health` says: a single word, and nothing about the host. */
export type PublicHealth = { status: "ok" | "degraded" }

/** Roles the API lets read `/health/detailed`. Kept in step with health.routes.ts. */
export const HEALTH_DETAIL_ROLES = ["OWNER", "ADMIN"] as const

export function canViewHealthDetails(role: string | null | undefined): boolean {
  return (HEALTH_DETAIL_ROLES as readonly string[]).includes(role ?? "")
}

/**
 * The per-service breakdown, for an owner or admin.
 *
 * The public `/health` was reduced to `{ status }` so an unauthenticated caller
 * no longer gets an inventory of the host; the breakdown moved behind a session
 * to `/health/detailed`. The dashboard kept asking the public endpoint for the
 * breakdown, rejected the one-word answer, and sat on "Checking services…".
 */
export async function fetchHealthDetails(signal?: AbortSignal): Promise<HealthStatus> {
  const data = await fetchApi<HealthStatus>("/health/detailed", { signal })
  if (!data?.api) {
    throw new Error("Health check returned an unrecognised payload.")
  }
  return data
}

/**
 * Whether the instance answers at all, for anyone signed in.
 *
 * `/health` answers 503 while a critical dependency is down, which is what lets
 * Docker and any supervisor see the outage. The body of that 503 is a
 * successful report about a degraded system, not an error, so it is read here
 * rather than thrown. Anything else — unreachable API, non-JSON, a shape we do
 * not recognise — is still a genuine failure and still throws.
 */
export async function fetchPublicHealth(signal?: AbortSignal): Promise<PublicHealth> {
  const response = await fetch(`${clientApiBase}/health`, {
    credentials: "include",
    signal,
  })

  if (!response.ok && response.status !== 503) {
    throw new Error(`Health check failed with ${response.status}.`)
  }

  const payload = (await response.json()) as { data?: { status?: unknown } }
  const status = payload?.data?.status
  if (status !== "ok" && status !== "degraded") {
    throw new Error("Health check returned an unrecognised payload.")
  }

  return { status }
}
