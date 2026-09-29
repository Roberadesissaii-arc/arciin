import type { PublicHealth } from "@/lib/api/health"
import type { HealthStatus } from "@/lib/types/models"

export const SYSTEM_SERVICES = ["api", "database", "redis", "worker", "storage"] as const

export type SystemService = (typeof SYSTEM_SERVICES)[number]

export const SYSTEM_STATUS_COPY = {
  loading: "Checking services…",
  allOnline: "All services responding on this host.",
  error: "Could not load service status.",
  summaryOk: "Arciin is responding on this host.",
  summaryDegraded: "Arciin is running with reduced service. An owner or admin can see which part.",
} as const

export function countOnlineServices(health: HealthStatus): number {
  return SYSTEM_SERVICES.filter((service) => health[service] === "online").length
}

/**
 * The one line above the System cards.
 *
 * A failed request is not a loading state. This used to key off "is there any
 * data yet", so a request that had already failed read "Checking services…"
 * for as long as the page stayed open.
 */
export function describeSystemStatus(input: {
  isPending: boolean
  isError: boolean
  health: HealthStatus | undefined
}): string {
  // An error wins over older data: TanStack Query keeps the last good answer
  // after a refetch fails (it has already retried), and the cards then say
  // "Unreachable" — the line above them must not still say all is well.
  if (input.isError) return SYSTEM_STATUS_COPY.error
  if (input.health) {
    const online = countOnlineServices(input.health)
    return online === SYSTEM_SERVICES.length
      ? SYSTEM_STATUS_COPY.allOnline
      : `${online} of ${SYSTEM_SERVICES.length} services online.`
  }
  return input.isPending ? SYSTEM_STATUS_COPY.loading : SYSTEM_STATUS_COPY.error
}

/**
 * The same line for a member or viewer, who may not read the breakdown.
 *
 * The API keeps `/health/detailed` to owners and admins, and that is not
 * loosened for a dashboard card. Everyone else gets the public one-word answer.
 */
export function describePublicSystemStatus(input: {
  isPending: boolean
  isError: boolean
  health: PublicHealth | undefined
}): string {
  if (input.isError) return SYSTEM_STATUS_COPY.error
  if (input.health) {
    return input.health.status === "ok"
      ? SYSTEM_STATUS_COPY.summaryOk
      : SYSTEM_STATUS_COPY.summaryDegraded
  }
  return input.isPending ? SYSTEM_STATUS_COPY.loading : SYSTEM_STATUS_COPY.error
}
