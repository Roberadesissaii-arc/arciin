import type { QueryClient } from "@tanstack/react-query"

import { queryKeys } from "@/lib/api/query-keys"

/**
 * Window in which repeat calls collapse into a single trailing refresh.
 *
 * Bulk actions emit one realtime event per asset, and each one used to run a
 * full invalidate plus a forced refetch. Moving 10 files produced 51 page
 * refetches and 41 library refetches, so the grid flickered items out and back
 * in for the whole batch. 400ms still feels immediate for a single event.
 */
const COALESCE_MS = 400

type Pending = {
  timer: ReturnType<typeof setTimeout>
  libraryIds: Set<string>
  /** Any event at all during the window still needs a trailing refresh, even without a libraryId. */
  hits: number
}

const pendingByClient = new WeakMap<QueryClient, Pending>()

function runRefresh(queryClient: QueryClient, libraryIds: Set<string>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
  void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
  void queryClient.invalidateQueries({ queryKey: ["folders"] })

  for (const id of libraryIds) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.library(id) })
  }

  // Deliberately no refetchQueries({ type: "all" }). invalidateQueries already
  // refetches whatever is mounted; forcing inactive queries too meant every
  // cached page of every past filter refetched on each event, which is what
  // turned a burst into a stampede. Inactive queries are left marked stale and
  // refetch when they next mount.
}

/**
 * Depth of in-flight bulk operations (move, delete, …).
 *
 * A bulk action emits one realtime event per asset while it runs. Even
 * coalesced, a multi-second batch spans many windows and still refetched the
 * grid over and over mid-flight — which is the flicker. The caller owns the
 * refresh for the whole batch instead, so events are parked until it finishes.
 */
let bulkDepth = 0

export function beginBulkLibraryMutation() {
  bulkDepth += 1
}

/**
 * Pair with beginBulkLibraryMutation. Runs exactly one refresh for the batch —
 * callers must not invalidate again themselves, or the grid refetches twice.
 */
export function endBulkLibraryMutation(queryClient: QueryClient) {
  bulkDepth = Math.max(0, bulkDepth - 1)
  if (bulkDepth > 0) return
  runRefresh(queryClient, new Set())
}

/**
 * Invalidate library grids after realtime asset/upload events.
 *
 * Refreshes immediately, then swallows further calls for a short window and
 * runs one trailing refresh for whatever arrived in between.
 */
export function refreshLibraryQueries(queryClient: QueryClient, libraryId?: string) {
  if (bulkDepth > 0) {
    // The caller owns one refresh for the whole batch; see endBulkLibraryMutation.
    return
  }

  const pending = pendingByClient.get(queryClient)

  if (pending) {
    // Already refreshed on the leading edge — fold this into the trailing run.
    pending.hits += 1
    if (libraryId) pending.libraryIds.add(libraryId)
    return
  }

  const leadingIds = new Set<string>()
  if (libraryId) leadingIds.add(libraryId)
  runRefresh(queryClient, leadingIds)

  const entry: Pending = {
    libraryIds: new Set<string>(),
    hits: 0,
    timer: setTimeout(() => {
      pendingByClient.delete(queryClient)
      if (entry.hits > 0) {
        runRefresh(queryClient, entry.libraryIds)
      }
    }, COALESCE_MS),
  }
  pendingByClient.set(queryClient, entry)
}
