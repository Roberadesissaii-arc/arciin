"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { cancelUpload, getUploads } from "@/lib/api/uploads"
import { queryKeys } from "@/lib/api/query-keys"

export function useUploads() {
  return useQuery({
    queryKey: queryKeys.uploads,
    queryFn: ({ signal }) => getUploads(signal),
  })
}

export function useCancelUpload() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (uploadId: string) => cancelUpload(uploadId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.uploads,
      })
    },
  })
}
