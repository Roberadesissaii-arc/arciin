"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import {
  deleteAsset,
  getAssets,
  getAssetsPage,
  moveAsset,
  updateAsset,
  type AssetFilters,
  type AssetPageFilters,
} from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import type { AssetSummary } from "@/lib/types/models"
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

/**
 * Cursor-paginated assets for library and folder browsing.
 *
 * The query key carries every filter, so changing search, scope, folder,
 * library, or category starts a fresh pagination run rather than appending to
 * the previous one — no stale first page, no duplicates across pages.
 */
export function useAssetsPage(filters: AssetPageFilters = {}) {
  const socketConnected = useSocketStore((state) => state.connected)

  return useInfiniteQuery({
    queryKey: queryKeys.assetsPage(filters as Record<string, unknown>),
    queryFn: ({ pageParam, signal }) =>
      getAssetsPage(
        {
          ...filters,
          cursor: pageParam ?? undefined,
          // The total only needs computing once per filter set.
          withTotal: !pageParam,
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: true,
    // Matches useAssets: poll when the socket is down so uploads still appear.
    refetchInterval: socketConnected ? false : 12_000,
    refetchIntervalInBackground: false,
  })
}

/**
 * Apply `fn` to every asset in a cached ["assets"] entry, whatever its shape.
 *
 * That prefix deliberately covers both plain AssetSummary[] lists and the
 * paginated browser, which is a useInfiniteQuery holding { pages, pageParams }.
 * Callers that assumed an array threw "old.map is not a function" — and inside
 * onMutate that aborts the mutation before it ever reaches the API, so a bulk
 * move silently moved nothing on exactly the library grids it is used from.
 */
function mapCachedAssets(old: unknown, fn: (a: AssetSummary) => AssetSummary): unknown {
  if (!old) return old

  if (Array.isArray(old)) {
    return (old as AssetSummary[]).map(fn)
  }

  const paged = old as { pages?: { items?: AssetSummary[] }[] }
  if (Array.isArray(paged.pages)) {
    return {
      ...paged,
      pages: paged.pages.map((page) =>
        Array.isArray(page?.items) ? { ...page, items: page.items.map(fn) } : page,
      ),
    }
  }

  // Unknown shape — leave it for the invalidate that follows to refetch.
  return old
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
      //
      // The ["assets"] prefix deliberately covers several different cache
      // shapes: plain AssetSummary[] lists and the paginated browser, which is
      // a useInfiniteQuery holding { pages, pageParams }. Assuming an array
      // here threw "old.map is not a function" inside onMutate, which aborts
      // the mutation before it ever calls the API — so bulk move silently moved
      // nothing on exactly the library grids people use it from.
      const applyMove = (a: AssetSummary): AssetSummary =>
        a.id !== assetId
          ? a
          : { ...a, folderId: folderId ?? null, libraryId: libraryId ?? a.libraryId }

      queryClient.setQueriesData({ queryKey: ["assets"] }, (old: unknown) =>
        mapCachedAssets(old, applyMove),
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
      // Same shape hazard as the move above — rename from a paginated grid hit it too.
      queryClient.setQueriesData({ queryKey: ["assets"] }, (old: unknown) =>
        mapCachedAssets(old, (a) => (a.id === updated.id ? { ...a, ...updated } : a)),
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
    },
  })
}
