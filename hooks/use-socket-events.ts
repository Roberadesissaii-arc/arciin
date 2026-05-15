"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Socket } from "socket.io-client"

import { queryKeys } from "@/lib/api/query-keys"
import { useSocketStore } from "@/lib/stores/socket-store"
import { useUploadStore } from "@/lib/stores/upload-store"
import {
  shouldShowActivityFeedToast,
  shouldShowSecurityEventsToast,
} from "@/lib/preferences/notification-policy"
import type { SocketEventPayload } from "@/lib/types/events"

export function useSocketEvents(socket: Socket | null) {
  const queryClient = useQueryClient()
  const addOrUpdate = useUploadStore((state) => state.addOrUpdate)
  const updateProgress = useUploadStore((state) => state.updateProgress)
  const updateStatus = useUploadStore((state) => state.updateStatus)
  const setConnected = useSocketStore((state) => state.setConnected)
  const setLastEventAt = useSocketStore((state) => state.setLastEventAt)

  useEffect(() => {
    if (!socket) {
      return
    }

    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    socket.onAny((type, payload: SocketEventPayload) => {
      setLastEventAt(new Date().toISOString())

      if (payload.uploadId) {
        if (type === "upload.started") {
          addOrUpdate({
            id: payload.uploadId,
            fileName: String(payload.data?.fileName || "Upload"),
            sizeBytes: Number(payload.data?.sizeBytes || 0),
            progress: payload.progress ?? 0,
            status: "UPLOADING",
            destination: String(payload.data?.destination || "Inbox"),
            uploadId: payload.uploadId,
          })
        }

        if (typeof payload.progress === "number") {
          updateProgress(payload.uploadId, payload.progress)
        }

        if (type === "upload.completed" && payload.uploadId) {
          updateProgress(payload.uploadId, payload.progress ?? 100)
          updateStatus(payload.uploadId, "READY")
        }

        if (type === "upload.failed") {
          updateStatus(payload.uploadId, "FAILED", payload.message)
        }
      }

      if (type === "activity.created") {
        const eventType = String(payload.data?.type || "")
        const title = String(payload.data?.title || "New activity")
        const message = payload.data?.message ? String(payload.data.message) : undefined
        const isSecurity = eventType.startsWith("auth.")

        if (isSecurity && shouldShowSecurityEventsToast()) {
          toast.warning(title, message ? { description: message } : undefined)
        } else if (shouldShowActivityFeedToast()) {
          toast.message(title, message ? { description: message } : undefined)
        }
      }

      if (
        type.startsWith("upload.") ||
        type.startsWith("asset.") ||
        type.startsWith("activity.") ||
        type.startsWith("job.") ||
        type === "thumbnail.created"
      ) {
        queryClient.invalidateQueries({ queryKey: queryKeys.uploads })
        queryClient.invalidateQueries({ queryKey: queryKeys.activity() })
        queryClient.invalidateQueries({ queryKey: queryKeys.assets() })
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
      }
    })

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.offAny()
    }
  }, [
    addOrUpdate,
    queryClient,
    setConnected,
    setLastEventAt,
    socket,
    updateProgress,
    updateStatus,
  ])
}
