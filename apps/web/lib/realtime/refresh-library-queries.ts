import type { QueryClient } from "@tanstack/react-query"

import { queryKeys } from "@/lib/api/query-keys"

/** Invalidate and refetch library grids after realtime asset/upload events. */
export function refreshLibraryQueries(queryClient: QueryClient, libraryId?: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
  void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
  void queryClient.invalidateQueries({ queryKey: ["folders"] })

  if (libraryId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.library(libraryId) })
  }

  void queryClient.refetchQueries({
    queryKey: queryKeys.assetsRoot,
    type: "all",
  })
  void queryClient.refetchQueries({
    queryKey: queryKeys.libraries,
    type: "all",
  })
}
