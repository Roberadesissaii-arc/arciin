"use client"

import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Socket } from "socket.io-client"

import { queryKeys } from "@/lib/api/query-keys"
import {
  applyTranscriptRealtimeToAssetCache,
  isTranscriptRealtimeType,
} from "@/lib/realtime/apply-transcript-activity"
import { refreshLibraryQueries } from "@/lib/realtime/refresh-library-queries"
import { buildLiveSocketEvent, useEventsFeedStore } from "@/lib/stores/events-feed-store"
import { useSocketStore } from "@/lib/stores/socket-store"
import { useUploadStore } from "@/lib/stores/upload-store"
import { notifyPublicUrlChanged } from "@/lib/notifications/notify-public-url-changed"
import {
  notifyUploadCompleted,
  notifyUploadFailedEvent,
  uploadNotifyDedupeKey,
} from "@/lib/notifications/notify-upload-realtime"
import {
  parseUploadCompletePayload,
  parseUploadFailedPayload,
} from "@/lib/notifications/upload-toast-resolver"
import { extractClientIpFromSecurityText } from "@/lib/notifications/toast-copy"
import {
  notifyApiRequestBlocked,
  notifyIpPolicy,
  notifyInfo,
  notifyShareFeedback,
  notifyWarning,
} from "@/lib/notifications/toast-actions"
import { shouldToastForActivityEvent } from "@/lib/notifications/activity-toast-policy"
import {
  shouldShowActivityFeedToast,
  shouldShowSecurityEventsToast,
} from "@/lib/preferences/notification-policy"
import type { SocketEventPayload } from "@/lib/types/events"
import { socketEventTypes } from "@/lib/types/events"

export function useSocketEvents(socket: Socket | null) {
  const queryClient = useQueryClient()
  const addOrUpdate = useUploadStore((state) => state.addOrUpdate)
  const updateProgress = useUploadStore((state) => state.updateProgress)
  const updateStatus = useUploadStore((state) => state.updateStatus)
  const setConnected = useSocketStore((state) => state.setConnected)
  const setLastEventAt = useSocketStore((state) => state.setLastEventAt)
  const pushFeedEvent = useEventsFeedStore((state) => state.push)
  const seenIdsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!socket) {
      return
    }

    const onConnect = () => {
      setConnected(true)
      // Opt into the instance-wide feed. The server gates this by role
      // (OWNER/ADMIN only) before joining the instance room, so it is safe to
      // always request it — members simply keep their user-scoped stream.
      // Re-emitted on every (re)connect so the room is rejoined after drops.
      socket.emit("subscribe:instance-events")
    }
    const onDisconnect = () => setConnected(false)

    const handleRealtimeEvent = (type: string, payload: SocketEventPayload) => {
      const eventId = payload?.id
      if (eventId) {
        if (seenIdsRef.current.has(eventId)) return
        seenIdsRef.current.add(eventId)
        if (seenIdsRef.current.size > 500) {
          seenIdsRef.current.clear()
        }
      }

      setLastEventAt(new Date().toISOString())
      pushFeedEvent(buildLiveSocketEvent(type, payload))

      if (payload.uploadId) {
        if (type === "upload.started") {
          const isUrlImportStart =
            payload.data?.origin === "url" || payload.data?.source === "url"
          const startedProgress = isUrlImportStart
            ? Math.max(payload.progress ?? 0, 12)
            : (payload.progress ?? 0)
          const startedDestination =
            typeof payload.data?.destination === "string" &&
            payload.data.destination.trim().length > 0 &&
            payload.data.destination !== "Inbox"
              ? payload.data.destination
              : undefined

          addOrUpdate({
            id: payload.uploadId,
            fileName: String(payload.data?.fileName || "Upload"),
            sizeBytes: Number(payload.data?.sizeBytes || 0),
            progress: startedProgress,
            status: "UPLOADING",
            destination: startedDestination ?? "Inbox",
            uploadId: payload.uploadId,
          })
        }

        if (typeof payload.progress === "number") {
          updateProgress(payload.uploadId, payload.progress)
          const progressDestination =
            typeof payload.data?.destination === "string" &&
            payload.data.destination.trim().length > 0
              ? payload.data.destination
              : undefined
          if (progressDestination) {
            addOrUpdate({
              id: payload.uploadId,
              fileName: String(payload.data?.fileName || "Upload"),
              sizeBytes: Number(payload.data?.sizeBytes || 0),
              progress: payload.progress,
              destination: progressDestination,
              uploadId: payload.uploadId,
            })
          }
        }

        if (type === "upload.completed" && payload.uploadId) {
          const progress = payload.progress ?? 100
          updateProgress(payload.uploadId, progress)
          updateStatus(
            payload.uploadId,
            progress >= 100 ? "READY" : "PROCESSING",
          )
        }

        if (type === "upload.failed") {
          updateStatus(payload.uploadId, "FAILED", payload.message)
        }
      }

      if (type === "upload.completed") {
        const { origin, client, fileName, destination } = parseUploadCompletePayload(payload)
        notifyUploadCompleted({
          dedupeKey: uploadNotifyDedupeKey(payload),
          origin,
          client,
          fileName,
          destination,
          uploadId: payload.uploadId,
        })
      }

      if (type === "upload.failed") {
        const { origin, fileName, message } = parseUploadFailedPayload(payload)
        notifyUploadFailedEvent({
          dedupeKey: uploadNotifyDedupeKey(payload),
          origin,
          fileName,
          message: message ? String(message) : undefined,
          uploadId: payload.uploadId,
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
        const activityId =
          payload.data?.activityId != null ? String(payload.data.activityId) : undefined
        const isSecurity =
          eventType.startsWith("auth.") || eventType.startsWith("security.")

        if (eventType === "share.feedback") {
          notifyShareFeedback(title, message)
        } else if (eventType === "upload.completed" || eventType === "upload.failed") {
          if (eventType === "upload.completed") {
            const libraryId =
              typeof payload.data?.libraryId === "string"
                ? payload.data.libraryId
                : undefined
            refreshLibraryQueries(queryClient, libraryId)

            // The activity row is written as soon as the bytes land, but when a
            // worker job still has to run the completion toast belongs to the
            // worker's own upload.completed event. Toasting here too would show
            // the user two "uploaded" notifications for one file. Cache
            // invalidation below still runs — only the toast is deferred.
            const awaitingWorker = payload.data?.pendingProcessing === true

            if (!awaitingWorker) {
              const client =
                payload.data?.client === "mobile" ? ("mobile" as const) : ("web" as const)
              const destination =
                typeof payload.data?.destination === "string"
                  ? payload.data.destination
                  : undefined
              const entityId =
                payload.data?.entityId != null ? String(payload.data.entityId) : undefined
              let fileName =
                typeof payload.data?.fileName === "string"
                  ? payload.data.fileName.trim()
                  : ""
              if (!fileName && message) {
                const match = message.match(/^(.+?)\s+routed to\s+/i)
                if (match?.[1]) fileName = match[1].trim()
              }

              notifyUploadCompleted({
                dedupeKey:
                  entityId || (activityId ? `activity:${activityId}` : "activity-upload"),
                origin: "upload",
                client,
                fileName: fileName || undefined,
                destination,
                uploadId: entityId,
              })
            }
          }
          /* no generic activity toast */
        } else if (
          eventType === "api-key.created" ||
          eventType === "api-key.rotated" ||
          eventType === "api-key.revoked"
        ) {
          /* Dedicated API key action toasts — avoid generic green activity toast */
        } else if (eventType === "remote.public_url_changed") {
          /* Toast + inbox handled on instance.urls.updated to avoid duplicates */
        } else if (isSecurity && shouldShowSecurityEventsToast()) {
          if (eventType === "security.ip_denied") {
            notifyApiRequestBlocked(title, message)
          } else if (eventType === "security.ip_blocklist_added") {
            const ip = extractClientIpFromSecurityText(message ?? title)
            if (ip) notifyIpPolicy("blocked", ip)
            else notifyApiRequestBlocked(title, message)
          } else if (eventType === "security.ip_blocklist_removed") {
            const ip = extractClientIpFromSecurityText(message ?? title)
            if (ip) notifyIpPolicy("unblocked", ip)
            else notifyApiRequestBlocked(title, message)
          } else if (eventType === "security.ip_allowlist_added") {
            const ip = extractClientIpFromSecurityText(message ?? title)
            if (ip) notifyIpPolicy("allowlisted", ip)
            else notifyApiRequestBlocked(title, message)
          } else if (eventType === "security.ip_allowlist_removed") {
            const ip = extractClientIpFromSecurityText(message ?? title)
            if (ip) notifyIpPolicy("disallowlisted", ip)
            else notifyApiRequestBlocked(title, message)
          } else if (eventType.startsWith("auth.")) {
            notifyWarning(title, message)
          } else {
            notifyApiRequestBlocked(title, message)
          }
        } else if (shouldShowActivityFeedToast() && shouldToastForActivityEvent(eventType)) {
          notifyInfo(title, message)
        }
      }

      // Another tab or device changed read state; the server holds the answer.
      if (type === "notifications.read") {
        queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot })
      }

      if (isTranscriptRealtimeType(type) && typeof payload.assetId === "string") {
        applyTranscriptRealtimeToAssetCache(queryClient, {
          type,
          assetId: payload.assetId,
          createdAt: payload.createdAt,
        })
      }

      if (
        type === "asset.created" ||
        type === "asset.updated" ||
        type === "asset.moved" ||
        type === "asset.deleted" ||
        type === "asset.classified" ||
        type === "asset.transcript.updated" ||
        type === "asset.transcript.ready" ||
        type === "asset.transcript.failed" ||
        type === "upload.completed" ||
        type === "thumbnail.created" ||
        type === "media.processing.completed"
      ) {
        const libraryId =
          typeof payload.libraryId === "string" ? payload.libraryId : undefined
        refreshLibraryQueries(queryClient, libraryId)
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
        queryClient.invalidateQueries({ queryKey: queryKeys.activityRoot })
        queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot })
        queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
        queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
      }

      if (type === "activity.created") {
        const eventType = String(payload.data?.type || "")
        if (
          eventType === "api-key.created" ||
          eventType === "api-key.rotated" ||
          eventType === "api-key.revoked"
        ) {
          queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys })
        }
      }
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)
    const listeners = new Map<string, (payload: SocketEventPayload) => void>()
    for (const eventType of socketEventTypes) {
      const listener = (payload: SocketEventPayload) => {
        handleRealtimeEvent(eventType, payload)
      }
      listeners.set(eventType, listener)
      socket.on(eventType, listener)
    }

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      for (const [eventType, listener] of listeners) {
        socket.off(eventType, listener)
      }
    }
  }, [
    addOrUpdate,
    pushFeedEvent,
    queryClient,
    setConnected,
    setLastEventAt,
    socket,
    updateProgress,
    updateStatus,
  ])
}
