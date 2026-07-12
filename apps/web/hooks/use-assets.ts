"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { deleteAsset, getAssets, moveAsset, updateAsset, type AssetFilters } from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import { useSocketStore } from "@/lib/stores/socket-store"

export function useAssets(filters: AssetFilters = {}) {
  const socketConnected = useSocketStore((state) => state.connected)

  return useQuery({
    queryKey: queryKeys.assets(filters),
    queryFn: ({ signal }) => getAssets(filters, signal),
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: true,
    // When Socket.IO is down (common after API restarts), poll so phone uploads still appear.
    refetchInterval: socketConnected ? false : 12_000,
    refetchIntervalInBackground: false,
  })
}

export function useMoveAsset() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      assetId,
      folderId,
      libraryId,
    }: {
      assetId: string
      folderId?: string
      libraryId?: string
    }) => moveAsset(assetId, { folderId, libraryId }),
    onMutate: async ({ assetId, folderId, libraryId }) => {
      // Cancel any in-flight asset fetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["assets"] })

      // Snapshot all current asset cache entries so we can roll back on error
      const previousEntries = queryClient.getQueriesData({ queryKey: ["assets"] })

      // Optimistically update every cached asset list:
      // - remove the asset from any list where it no longer belongs
      // - update its folderId/libraryId so the folder view picks it up
      queryClient.setQueriesData<import("@/lib/types/models").AssetSummary[]>(
        { queryKey: ["assets"] },
        (old) => {
          if (!old) return old
          return old.map((a) => {
            if (a.id !== assetId) return a
            return {
              ...a,
              folderId: folderId ?? null,
              libraryId: libraryId ?? a.libraryId,
            }
          })
        }
      )

      return { previousEntries }
    },
    onError: (_err, _vars, context) => {
      // Roll back optimistic update on failure
      if (context?.previousEntries) {
        for (const [queryKey, data] of context.previousEntries) {
          queryClient.setQueryData(queryKey, data)
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
    },
  })
}

export function useDeleteAsset() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (assetId: string) => deleteAsset(assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.assetsRoot,
      })
    },
  })
}

export function useUpdateAsset() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      assetId,
      ...input
    }: {
      assetId: string
      title?: string
      description?: string
      originalFilename?: string
      badgeLabel?: string | null
      badgeColor?: string | null
      showBadge?: boolean
    }) => updateAsset(assetId, input),
    onSuccess: (updated) => {
      queryClient.setQueriesData<import("@/lib/types/models").AssetSummary[]>(
        { queryKey: ["assets"] },
        (old) => old?.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)),
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
    },
  })
}
