import { fetchApi } from "@/lib/api/client"
import type { ActivitySummary } from "@/lib/types/models"

export function getActivity(signal?: AbortSignal) {
  return fetchApi<ActivitySummary[]>("/activity", {
    method: "GET",
    signal,
  })
}

/** Security-only feed: sign-ins, failed attempts, password changes, IP policy. */
export function getSecurityActivity(signal?: AbortSignal) {
  return fetchApi<ActivitySummary[]>("/activity/security", {
    method: "GET",
    signal,
  })
}
