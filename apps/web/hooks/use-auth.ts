"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { getMe, login, logout } from "@/lib/api/auth"
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
