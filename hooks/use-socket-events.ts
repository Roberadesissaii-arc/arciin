"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Socket } from "socket.io-client"

import { queryKeys } from "@/lib/api/query-keys"
import { useSocketStore } from "@/lib/stores/socket-store"
import { useUploadStore } from "@/lib/stores/upload-store"
import { notifyPublicUrlChanged } from "@/lib/notifications/notify-public-url-changed"
import { recordInboxNotification } from "@/lib/notifications/record-inbox-notification"
import {
  notifyUploadCompleted,
  notifyUploadFailed,
  uploadNotifyDedupeKey,
} from "@/lib/notifications/notify-upload-realtime"
import { shouldToastForActivityEvent } from "@/lib/notifications/activity-toast-policy"
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

      if (type === "upload.completed") {
        const fileName = payload.data?.fileName
        notifyUploadCompleted({
          dedupeKey: uploadNotifyDedupeKey(payload),
          title:
            typeof fileName === "string" && fileName
              ? `${fileName} uploaded`
              : String(payload.message || "Upload complete"),
          message:
            payload.message && typeof fileName === "string"
              ? String(payload.message)
              : undefined,
        })
      }

      if (type === "upload.failed") {
        const fileName = payload.data?.fileName
        notifyUploadFailed({
          dedupeKey: uploadNotifyDedupeKey(payload),
          title:
            typeof fileName === "string" && fileName
              ? `${fileName} could not be uploaded`
              : "Upload failed",
          message: payload.message ? String(payload.message) : undefined,
        })
      }

      if (type === "instance.urls.updated") {
        const webUrl = String(payload.data?.webUrl || "")
        const previousPublicUrl =
          typeof payload.data?.previousPublicUrl === "string"
            ? payload.data.previousPublicUrl
            : null
        if (webUrl) {
          notifyPublicUrlChanged(
            { newUrl: webUrl, previousUrl: previousPublicUrl },
            queryClient,
          )
        }
      }

      if (type === "activity.created") {
        const eventType = String(payload.data?.type || "")
        const title = String(
          payload.data?.title || payload.message || "New activity",
        )
        const message =
          payload.data?.message != null
            ? String(payload.data.message)
            : payload.message && payload.data?.title
              ? String(payload.message)
              : undefined
        const isSecurity = eventType.startsWith("auth.")

        // upload.completed / upload.failed are handled on dedicated socket events (with batch suppression).
        if (eventType === "upload.completed" || eventType === "upload.failed") {
          /* no activity toast */
        } else if (eventType === "remote.public_url_changed") {
          /* Toast + inbox handled on instance.urls.updated to avoid duplicates */
        } else if (isSecurity && shouldShowSecurityEventsToast()) {
          recordInboxNotification({
            title,
            message,
            variant: "warning",
            source: "security",
          })
          toast.warning(title, message ? { description: message } : undefined)
        } else if (shouldShowActivityFeedToast() && shouldToastForActivityEvent(eventType)) {
          recordInboxNotification({
            title,
            message,
            variant: "default",
            source: "activity",
          })
          toast.message(title, message ? { description: message } : undefined)
        }
      }

      if (
        type.startsWith("upload.") ||
        type.startsWith("asset.") ||
        type.startsWith("activity.") ||
        type.startsWith("job.") ||
        type === "thumbnail.created" ||
        type === "instance.urls.updated"
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
