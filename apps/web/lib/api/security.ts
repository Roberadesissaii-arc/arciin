import { fetchApi } from "@/lib/api/client"
import type { ActivitySummary } from "@/lib/types/models"

export function getSecurityLog(signal?: AbortSignal) {
  return fetchApi<ActivitySummary[]>("/settings/security/log", {
    method: "GET",
    signal,
  })
}
