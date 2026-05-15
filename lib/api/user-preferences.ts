import { fetchApi } from "@/lib/api/client"
import type { UserPreferences } from "@arciin/shared"

export function getUserPreferences(signal?: AbortSignal) {
  return fetchApi<UserPreferences>("/auth/preferences", { method: "GET", signal })
}

export function updateUserPreferences(
  patch: Partial<{
    notifications: Partial<UserPreferences["notifications"]>
    appearance: Partial<UserPreferences["appearance"]>
    accessibility: Partial<UserPreferences["accessibility"]>
  }>,
) {
  return fetchApi<UserPreferences>("/auth/preferences", {
    method: "PATCH",
    body: patch,
  })
}
