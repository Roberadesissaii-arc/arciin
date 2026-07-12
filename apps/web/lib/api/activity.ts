import { fetchApi } from "@/lib/api/client"
import type { ActivitySummary } from "@/lib/types/models"

export function getActivity(signal?: AbortSignal) {
  return fetchApi<ActivitySummary[]>("/activity", {
    method: "GET",
    signal,
  })
}
