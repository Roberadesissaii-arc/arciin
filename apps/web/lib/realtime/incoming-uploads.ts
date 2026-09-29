import type { QueryClient } from "@tanstack/react-query"

import type { FolderIncomingSummary, IncomingPhase } from "@arciin/types"

import { queryKeys } from "@/lib/api/query-keys"
import { refreshLibraryQueries } from "@/lib/realtime/refresh-library-queries"
import { useIncomingStore } from "@/lib/stores/incoming-store"

type Snapshot = { folders: FolderIncomingSummary[] }

const PHASES: readonly IncomingPhase[] = ["started", "progress", "verifying", "completed", "ended"]
const STATES: readonly FolderIncomingSummary["state"][] = ["RECEIVING", "VERIFYING", "WAITING", "IDLE"]

/** The event's payload, or null if it is not one this client understands. */
export function parseIncomingEvent(data: unknown): { phase: IncomingPhase; folder: FolderIncomingSummary } | null {
  if (!data || typeof data !== "object") return null
  const { phase, folder } = data as { phase?: unknown; folder?: Partial<FolderIncomingSummary> }
  if (!PHASES.includes(phase as IncomingPhase) || !folder || typeof folder !== "object") return null
  const numbers = [folder.activeUploadCount, folder.totalBytes, folder.receivedBytes, folder.progressPercent]
  if (typeof folder.folderId !== "string" || typeof folder.libraryId !== "string") return null
  if (numbers.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0)) return null
  if (!STATES.includes(folder.state as FolderIncomingSummary["state"])) return null
  return { phase: phase as IncomingPhase, folder: folder as FolderIncomingSummary }
}

/** One folder's new summary folded into a snapshot. A folder with nothing open drops out. Pure. */
export function mergeIncomingFolder(snapshot: Snapshot | undefined, folder: FolderIncomingSummary, libraryFilter: string | null): Snapshot | undefined {
  if (!snapshot) return snapshot
  if (libraryFilter && folder.libraryId !== libraryFilter) return snapshot
  const rest = snapshot.folders.filter((f) => f.folderId !== folder.folderId)
  return { folders: folder.activeUploadCount > 0 ? [...rest, folder] : rest }
}

/**
 * Apply a `file-request.incoming` event to every cached snapshot.
 *
 * The event carries the folder's fresh summary, so progress needs no
 * round-trip. A completion also refreshes the library so the new file and the
 * folder's counts appear, and marks the folder "Received" for a moment.
 */
export function applyIncomingEvent(queryClient: QueryClient, data: unknown): void {
  const parsed = parseIncomingEvent(data)
  if (!parsed) return
  const { phase, folder } = parsed
  for (const query of queryClient.getQueryCache().findAll({ queryKey: queryKeys.incomingUploadsRoot })) {
    const filter = query.queryKey[2]
    queryClient.setQueryData<Snapshot>(query.queryKey, (prev) =>
      mergeIncomingFolder(prev, folder, typeof filter === "string" && filter !== "all" ? filter : null),
    )
  }
  if (phase === "completed") {
    if (folder.activeUploadCount === 0) useIncomingStore.getState().markReceived(folder.folderId)
    refreshLibraryQueries(queryClient, folder.libraryId)
    void queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
  }
}
