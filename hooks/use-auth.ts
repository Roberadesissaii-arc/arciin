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
    },
  })
}
