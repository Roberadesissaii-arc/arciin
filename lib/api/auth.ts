import { fetchApi } from "@/lib/api/client"
import type {
  AuthSession,
  ChangePasswordInput,
  LoginInput,
  SessionDetail,
  UpdateProfileInput,
} from "@/lib/types/models"

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

export function changePassword(input: ChangePasswordInput) {
  return fetchApi<{ success: true }>("/auth/password", {
    method: "PATCH",
    body: input,
  })
}

export function updateProfile(input: UpdateProfileInput) {
  return fetchApi<AuthSession>("/auth/profile", {
    method: "PATCH",
    body: input,
  })
}

export function uploadProfileAvatar(file: File) {
  const formData = new FormData()
  formData.append("file", file)
  return fetchApi<AuthSession>("/auth/profile/avatar", {
    method: "POST",
    body: formData,
  })
}

export function removeProfileAvatar() {
  return fetchApi<AuthSession>("/auth/profile/avatar", {
    method: "DELETE",
  })
}

export function getSessions(signal?: AbortSignal) {
  return fetchApi<SessionDetail[]>("/auth/sessions", {
    method: "GET",
    signal,
  })
}

export function revokeSession(id: string) {
  return fetchApi<{ success: true }>(`/auth/sessions/${id}`, {
    method: "DELETE",
  })
}
