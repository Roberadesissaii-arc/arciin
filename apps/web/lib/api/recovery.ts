import { fetchApi } from "@/lib/api/client"

export type RecoveryLookupResult = {
  available: boolean
  question?: string
}

export function lookupPasswordRecovery(email: string, signal?: AbortSignal) {
  return fetchApi<RecoveryLookupResult>("/auth/recovery/lookup", {
    method: "POST",
    body: { email: email.trim().toLowerCase() },
    signal,
  })
}

export function resetPasswordWithRecovery(input: {
  email: string
  answer: string
  newPassword: string
}) {
  return fetchApi<{ success: true }>("/auth/recovery/reset", {
    method: "POST",
    body: {
      email: input.email.trim().toLowerCase(),
      answer: input.answer,
      newPassword: input.newPassword,
    },
  })
}
