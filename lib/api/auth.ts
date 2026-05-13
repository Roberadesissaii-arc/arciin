import { fetchApi } from "@/lib/api/client"
import type { AuthSession, LoginInput } from "@/lib/types/models"

export function getMe(signal?: AbortSignal) {
  return fetchApi<AuthSession>("/auth/me", {
    method: "GET",
    signal,
  })
}

export function login(input: LoginInput) {
  return fetchApi<AuthSession>("/auth/login", {
    method: "POST",
    body: input,
  })
}

export function logout() {
  return fetchApi<{ success: true }>("/auth/logout", {
    method: "POST",
  })
}
