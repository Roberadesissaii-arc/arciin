"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  getMe,
  isMfaChallenge,
  login,
  logout,
  submitMfaChallenge,
} from "@/lib/api/auth"
import { queryKeys } from "@/lib/api/query-keys"
import type { LoginInput } from "@/lib/types/models"

export function useAuth() {
  return useQuery({
    queryKey: queryKeys.authMe,
    queryFn: ({ signal }) => getMe(signal),
    retry: false,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: (data) => {
      // A challenge is not a session. Caching it as one would leave the app
      // believing it had signed somebody in on a correct password alone.
      if (isMfaChallenge(data)) return
      queryClient.setQueryData(queryKeys.authMe, data)
    },
  })
}

/** Second step of sign-in: exchange the ticket and a code for a session. */
export function useMfaChallenge() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { challengeToken: string; totp?: string; recoveryCode?: string }) =>
      submitMfaChallenge(input),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.authMe, data)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      queryClient.removeQueries({
        queryKey: queryKeys.authMe,
      })
      // Entitlement must not survive the session: leaving it cached let the
      // next user's first render inherit the previous user's plan.
      queryClient.removeQueries({ queryKey: ["license"] })
      if (typeof window !== "undefined") {
        try {
          for (const key of Object.keys(window.localStorage)) {
            if (key.startsWith("arciin-license-status")) window.localStorage.removeItem(key)
          }
        } catch {
          /* private mode — nothing cached to clear */
        }
      }
    },
  })
}
