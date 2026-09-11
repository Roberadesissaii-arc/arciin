import type { HealthStatus } from "@/lib/types/models"

const clientApiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"

/**
 * Read instance health, including when the instance is unhealthy.
 *
 * `/api/health` answers 503 while a critical dependency is down, which is what
 * lets Docker and any supervisor see the outage. The ordinary client treats a
 * non-2xx as a thrown error, and that would replace the per-service breakdown
 * with a generic failure at exactly the moment it is worth reading — the body
 * of a 503 here is a successful report about a degraded system, not an error.
 *
 * Anything else — unreachable API, non-JSON, a shape we do not recognise — is
 * still a genuine failure and still throws.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  const response = await fetch(`${clientApiBase}/health`, {
    credentials: "include",
    signal,
  })

  if (!response.ok && response.status !== 503) {
    throw new Error(`Health check failed with ${response.status}.`)
  }

  const payload = (await response.json()) as { data?: HealthStatus }
  if (!payload?.data?.api) {
    throw new Error("Health check returned an unrecognised payload.")
  }

  return payload.data
}
