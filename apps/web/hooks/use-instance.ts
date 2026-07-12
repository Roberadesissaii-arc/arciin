"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { claimInstance, getInstanceStatus } from "@/lib/api/instance"
import { queryKeys } from "@/lib/api/query-keys"
import type { ClaimInstanceInput } from "@/lib/types/models"

export function useInstance() {
  return useQuery({
    queryKey: queryKeys.instanceStatus,
    queryFn: ({ signal }) => getInstanceStatus(signal),
    retry: false,
  })
}

export function useClaimInstance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ClaimInstanceInput) => claimInstance(input),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.authMe, data)
      queryClient.invalidateQueries({
        queryKey: queryKeys.instanceStatus,
      })
    },
  })
}
