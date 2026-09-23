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

/**
 * Sign-in answers one of two ways.
 *
 * With MFA off the session comes back directly. With MFA on the password step
 * returns a short-lived ticket instead, and the caller exchanges it plus a
 * code at /auth/mfa/challenge. No session exists until that second call
 * succeeds.
 */
export type MfaChallengeRequired = {
  mfaRequired: true
  challengeToken: string
  expiresInSeconds: number
}

export function isMfaChallenge(
  result: AuthSession | MfaChallengeRequired,
): result is MfaChallengeRequired {
  return (result as MfaChallengeRequired).mfaRequired === true
}

export function login(input: LoginInput) {
  return fetchApi<AuthSession | MfaChallengeRequired>("/auth/login", {
    method: "POST",
    body: input,
  })
}

export function submitMfaChallenge(input: {
  challengeToken: string
  totp?: string
  recoveryCode?: string
}) {
  return fetchApi<AuthSession>("/auth/mfa/challenge", {
    method: "POST",
    body: input,
  })
}

export type MfaStatus = {
  enabled: boolean
  enabledAt: string | null
  enrollmentStarted: boolean
  recoveryCodesRemaining: number
}

export function getMfaStatus(signal?: AbortSignal) {
  return fetchApi<MfaStatus>("/auth/mfa", { method: "GET", signal })
}

/** Returns the secret and QR exactly once; it is never retrievable again. */
export function beginMfaEnrollment(input: { password: string }) {
  return fetchApi<{ secret: string; otpauthUri: string; qrDataUrl: string }>(
    "/auth/mfa/enroll",
    { method: "POST", body: input },
  )
}

export function verifyMfaEnrollment(input: { totp: string }) {
  return fetchApi<{ enabled: true; recoveryCodes: string[] }>("/auth/mfa/enroll/verify", {
    method: "POST",
    body: input,
  })
}

export function disableMfa(input: { password: string; totp?: string; recoveryCode?: string }) {
  return fetchApi<{ enabled: false }>("/auth/mfa/disable", { method: "POST", body: input })
}

export function regenerateRecoveryCodes(input: {
  password: string
  totp?: string
  recoveryCode?: string
}) {
  return fetchApi<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", {
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

export function setupPasswordRecovery(input: { question: string; answer: string }) {
  return fetchApi<{ success: true }>("/auth/recovery/setup", {
    method: "POST",
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
