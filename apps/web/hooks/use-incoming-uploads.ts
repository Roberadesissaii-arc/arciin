"use client"

import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"

import type { FolderIncomingSummary } from "@arciin/types"

import { getIncomingUploads } from "@/lib/api/file-requests"
import { queryKeys } from "@/lib/api/query-keys"
import { RECEIVED_FLASH_MS, useIncomingStore } from "@/lib/stores/incoming-store"

/**
 * Snapshot refresh while something is arriving. Realtime events keep it live
 * between refreshes; this catches what events cannot report — an upload going
 * quiet ("Waiting") or a session expiring — and anything missed while offline.
 */
const ACTIVE_REFETCH_MS = 20_000

/** Incoming File Request uploads for a library's folders (or every library). */
export function useIncomingUploads(libraryId?: string | null) {
  return useQuery({
    queryKey: queryKeys.incomingUploads(libraryId),
    queryFn: ({ signal }) => getIncomingUploads(libraryId ? { libraryId } : {}, signal),
    staleTime: 5_000,
    refetchInterval: (query) => ((query.state.data?.folders.length ?? 0) > 0 ? ACTIVE_REFETCH_MS : false),
    refetchOnWindowFocus: true,
    retry: false,
  })
}

/**
 * One folder's incoming state for display: its live summary, or a brief
 * "received" after its last upload landed, or nothing.
 */
export function useFolderIncoming(
  folders: FolderIncomingSummary[] | undefined,
  folderId: string,
): { summary: FolderIncomingSummary | null; justReceived: boolean } {
  const summary = folders?.find((f) => f.folderId === folderId) ?? null
  const receivedAt = useIncomingStore((s) => s.receivedAt[folderId])
  const clearReceived = useIncomingStore((s) => s.clearReceived)
  useEffect(() => {
    if (receivedAt == null) return
    const timer = window.setTimeout(() => clearReceived(folderId), Math.max(0, receivedAt + RECEIVED_FLASH_MS - Date.now()))
    return () => window.clearTimeout(timer)
  }, [clearReceived, folderId, receivedAt])
  return { summary, justReceived: summary == null && receivedAt != null }
}
