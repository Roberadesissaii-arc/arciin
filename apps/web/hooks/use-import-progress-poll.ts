"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { queryKeys } from "@/lib/api/query-keys"
import { getUpload } from "@/lib/api/uploads"
import { useUploadStore } from "@/lib/stores/upload-store"
import type { UploadStatus } from "@/lib/types/models"

const POLL_MS = 2000

function isActiveQueueItem(status: UploadStatus) {
  return status !== "READY" && status !== "FAILED"
}

function mapServerStatus(status: UploadStatus): UploadStatus {
  switch (status) {
    case "QUEUED":
      return "QUEUED"
    case "READY":
      return "READY"
    case "FAILED":
      return "FAILED"
    case "PROCESSING":
      return "PROCESSING"
    case "UPLOADING":
    case "UPLOADED":
    case "ANALYZING":
    case "CLASSIFIED":
      return "UPLOADING"
    default:
      return "UPLOADING"
  }
}

/** Poll upload sessions so queue + library grids stay in sync when socket events are missed. */
export function useImportProgressPoll() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false

    const refreshLibraries = () => {
      void queryClient.refetchQueries({ queryKey: queryKeys.assetsRoot, type: "all" })
      void queryClient.refetchQueries({ queryKey: queryKeys.libraries, type: "all" })
      void queryClient.refetchQueries({ queryKey: ["folders"] })
    }

    const poll = async () => {
      if (cancelled) return

      const { queue, updateProgress, addOrUpdate, updateStatus } = useUploadStore.getState()
      const active = queue.filter(
        (item) => item.uploadId && isActiveQueueItem(item.status),
      )
      if (active.length === 0) return

      let shouldRefresh = false

      for (const item of active) {
        if (!item.uploadId || cancelled) continue
        try {
          const session = await getUpload(item.uploadId)
          if (cancelled) return

          const fileName = session.originalFilename || item.fileName
          const destination = session.targetLibrary?.name ?? item.destination
          const mappedStatus = mapServerStatus(session.status)
          const progress = Math.max(item.progress ?? 0, session.progress ?? 0)

          addOrUpdate({
            id: item.id,
            uploadId: item.uploadId,
            fileName,
            mimeType: session.mimeType ?? item.mimeType,
            sizeBytes: Number(session.sizeBytes) || item.sizeBytes,
            progress,
            destination,
            status: mappedStatus,
          })

          updateProgress(item.uploadId, progress)

          if (session.status === "FAILED") {
            updateStatus(item.uploadId, "FAILED", session.error ?? "Import failed.")
          } else if (session.status === "READY") {
            updateProgress(item.uploadId, 100)
            updateStatus(item.uploadId, "READY")
            shouldRefresh = true
          } else if (session.status === "PROCESSING" || session.assetId) {
            updateProgress(item.uploadId, Math.max(progress, 88))
            updateStatus(item.uploadId, "PROCESSING")
            shouldRefresh = true
          } else if (session.status === "QUEUED") {
            updateStatus(item.uploadId, "QUEUED")
          } else {
            updateStatus(item.uploadId, mappedStatus)
          }
        } catch {
          // Ignore transient poll errors (network blips, session not found yet).
        }
      }

      if (shouldRefresh) {
        refreshLibraries()
      }
    }

    void poll()
    const interval = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [queryClient])
}
