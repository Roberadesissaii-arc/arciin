import { fetchApi } from "@/lib/api/client"
import type { AuthSession, ClaimInstanceInput, InstanceStatus } from "@/lib/types/models"

export type UpdateCheckResult = {
  configured: boolean
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  channel: string | null
  changelogUrl: string | null
  notes: string | null
  checkedAt: string
  error: string | null
}

export function getInstanceStatus(signal?: AbortSignal) {
  return fetchApi<InstanceStatus>("/instance/status", {
    method: "GET",
    signal,
  })
}

export function getUpdateCheck(options?: { refresh?: boolean; signal?: AbortSignal }) {
  return fetchApi<UpdateCheckResult>(
    `/instance/update-check${options?.refresh ? "?refresh=1" : ""}`,
    { method: "GET", signal: options?.signal },
  )
}

export function claimInstance(input: ClaimInstanceInput) {
  return fetchApi<AuthSession>("/instance/claim", {
    method: "POST",
    body: {
      ...input,
      libraries: input.libraries,
    },
  })
}
