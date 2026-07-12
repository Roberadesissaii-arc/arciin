import { fetchApi } from "@/lib/api/client"
import type { AuthSession, ClaimInstanceInput, InstanceStatus } from "@/lib/types/models"

export function getInstanceStatus(signal?: AbortSignal) {
  return fetchApi<InstanceStatus>("/instance/status", {
    method: "GET",
    signal,
  })
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
