import {
  shouldPlayUploadSound,
  shouldShowUploadCompleteToast,
  shouldShowUploadFailedToast,
} from "@/lib/preferences/notification-policy"
import { playUploadCompleteSound } from "@/lib/preferences/upload-sound"

import { useUploadStore } from "@/lib/stores/upload-store"

import {
  notifyFileUploaded,
  notifyImportFailed,
  notifyLinkImported,
  notifyMobileFileUploaded,
  notifyUploadComplete,
  notifyUploadFailed,
} from "./toast-actions"
import { importFileCopy, uploadFileCopy, uploadMobileFileCopy } from "./toast-copy"
import { recordInboxNotification } from "./record-inbox-notification"
import type { UploadClientChannel, UploadCompleteOrigin } from "./upload-toast-resolver"

/**
 * Short-lived dedupe: the same completion arrives via both the upload socket
 * event and the activity event within seconds — suppress the duplicate, but
 * expire keys so uploading the same file name again later still notifies.
 */
const DEDUPE_TTL_MS = 20_000
const recentKeys = new Map<string, number>()

function pruneExpiredKeys(now: number) {
  for (const [key, at] of recentKeys) {
    if (now - at > DEDUPE_TTL_MS) recentKeys.delete(key)
  }
}

function expandDedupeKeys(key: string) {
  const trimmed = key.trim()
  if (!trimmed) return [] as string[]
  const keys = new Set<string>([trimmed])
  const parts = trimmed.split(":")
  if (parts.length === 2 && parts[0] && parts[1]) {
    keys.add(parts[0])
    keys.add(parts[1])
  }
  return [...keys]
}

/** Register upload ids so socket retries do not toast again after batch mode ends. */
export function markUploadNotifySeen(keys: string[]) {
  const now = Date.now()
  pruneExpiredKeys(now)
  for (const key of keys) {
    for (const expanded of expandDedupeKeys(key)) {
      recentKeys.set(`upload:ok:${expanded}`, now)
      recentKeys.set(`upload:fail:${expanded}`, now)
      recentKeys.set(expanded, now)
    }
  }
}

function claimDedupeKeys(keys: string[], prefix: "upload:ok" | "upload:fail") {
  const normalized = keys.flatMap((key) => expandDedupeKeys(key))
  if (normalized.length === 0) return false

  const now = Date.now()
  pruneExpiredKeys(now)

  const aliases = normalized.flatMap((key) => [`${prefix}:${key}`, key])
  if (aliases.some((alias) => recentKeys.has(alias))) return false

  for (const alias of aliases) {
    recentKeys.set(alias, now)
  }
  return true
}

function batchHandlesNotifications(uploadId?: string) {
  const batch = useUploadStore.getState().uploadBatch
  if (!batch || batch.finished >= batch.total) return false

  if (!uploadId) return false

  const queue = useUploadStore.getState().queue
  return queue.some(
    (item) =>
      item.batchId === batch.id &&
      (item.id === uploadId || item.uploadId === uploadId),
  )
}

export function notifyUploadCompleted(input: {
  dedupeKey: string
  origin?: UploadCompleteOrigin
  client?: UploadClientChannel
  fileName?: string
  destination?: string
  uploadId?: string
}) {
  const keys = buildUploadDedupeKeys(input.dedupeKey, input.fileName, input.client)
  const claimed = claimDedupeKeys(keys, "upload:ok")

  if (batchHandlesNotifications(input.uploadId)) return

  if (!claimed) return

  const isImport = input.origin === "url"
  const isMobile = input.client === "mobile"
  const copy = isImport
    ? input.fileName
      ? importFileCopy(input.fileName, input.destination)
      : { title: "Link downloaded", description: "Arciin finished fetching the file from the link." }
    : isMobile && input.fileName
      ? uploadMobileFileCopy(input.fileName, input.destination)
      : input.fileName
        ? uploadFileCopy(input.fileName, input.destination)
        : isMobile
          ? {
              title: "Uploaded from your phone",
              description: "A file from Arciin mobile was saved on your server.",
            }
          : {
              title: "File uploaded",
              description: "Your file was saved on the server and added to your library.",
            }

  recordInboxNotification({
    title: copy.title,
    message: copy.description,
    variant: "success",
    source: "upload",
  })

  if (shouldPlayUploadSound()) void playUploadCompleteSound()
  if (!shouldShowUploadCompleteToast()) return

  if (isImport && input.fileName) {
    notifyLinkImported(input.fileName, input.destination)
    return
  }

  if (isMobile && input.fileName) {
    notifyMobileFileUploaded(
      input.fileName,
      input.destination,
      input.uploadId ? `arciin-mobile-upload-${input.uploadId}` : undefined,
    )
    return
  }

  if (input.fileName) {
    notifyFileUploaded(input.fileName, input.destination)
    return
  }

  notifyUploadComplete(1, 1)
}

export function notifyUploadFailedEvent(input: {
  dedupeKey: string
  origin?: UploadCompleteOrigin
  fileName?: string
  message?: string
  uploadId?: string
}) {
  const keys = buildUploadDedupeKeys(input.dedupeKey, input.fileName)
  const claimed = claimDedupeKeys(keys, "upload:fail")

  if (batchHandlesNotifications(input.uploadId)) return

  if (!claimed) return

  const isImport = input.origin === "url"

  recordInboxNotification({
    title: isImport ? "Download failed" : "Upload failed",
    message: input.message,
    variant: "error",
    source: "upload",
  })

  if (!shouldShowUploadFailedToast()) return

  if (isImport) {
    notifyImportFailed(input.fileName, input.message)
    return
  }

  notifyUploadFailed(input.fileName, input.message)
}

function buildUploadDedupeKeys(
  primaryKey: string,
  fileName?: string,
  client?: UploadClientChannel,
) {
  const keys = new Set<string>()
  const trimmed = primaryKey.trim()
  if (trimmed) keys.add(trimmed)
  if (client !== "mobile") {
    const name = fileName?.trim()
    if (name) keys.add(`file:${name}`)
  }
  return [...keys]
}

export function uploadNotifyDedupeKey(payload: {
  uploadId?: string
  assetId?: string
  id?: string
  data?: Record<string, unknown>
}) {
  const entityId = payload.data?.entityId
  const uploadId = payload.uploadId ? String(payload.uploadId) : ""
  const assetId = payload.assetId ? String(payload.assetId) : ""
  const entity = typeof entityId === "string" ? entityId : ""
  const fallback = payload.id ? String(payload.id) : ""

  if (uploadId && assetId) return `${uploadId}:${assetId}`
  return uploadId || assetId || entity || fallback
}
