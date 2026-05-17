import { toast } from "sonner"

import {
  shouldPlayUploadSound,
  shouldShowUploadCompleteToast,
  shouldShowUploadFailedToast,
} from "@/lib/preferences/notification-policy"
import { playUploadCompleteSound } from "@/lib/preferences/upload-sound"

import { recordInboxNotification } from "./record-inbox-notification"

const recentKeys = new Map<string, number>()
const DEDUPE_MS = 12_000

function claimDedupeKey(key: string) {
  const now = Date.now()
  for (const [k, at] of recentKeys) {
    if (now - at > DEDUPE_MS) recentKeys.delete(k)
  }
  if (recentKeys.has(key)) return false
  recentKeys.set(key, now)
  return true
}

export function notifyUploadCompleted(input: {
  dedupeKey: string
  title: string
  message?: string
}) {
  const key = input.dedupeKey.trim()
  if (!key || !claimDedupeKey(`upload:ok:${key}`)) return

  recordInboxNotification({
    title: input.title,
    message: input.message,
    variant: "success",
    source: "upload",
  })

  if (shouldPlayUploadSound()) void playUploadCompleteSound()
  if (shouldShowUploadCompleteToast()) {
    toast.success(input.title, input.message ? { description: input.message } : undefined)
  }
}

export function notifyUploadFailed(input: {
  dedupeKey: string
  title: string
  message?: string
}) {
  const key = input.dedupeKey.trim()
  if (!key || !claimDedupeKey(`upload:fail:${key}`)) return

  recordInboxNotification({
    title: input.title,
    message: input.message,
    variant: "error",
    source: "upload",
  })

  if (shouldShowUploadFailedToast()) {
    toast.error(input.title, input.message ? { description: input.message } : undefined)
  }
}

export function uploadNotifyDedupeKey(payload: {
  uploadId?: string
  assetId?: string
  id?: string
  data?: Record<string, unknown>
}) {
  const entityId = payload.data?.entityId
  return String(
    payload.uploadId ||
      payload.assetId ||
      (typeof entityId === "string" ? entityId : "") ||
      payload.id ||
      "",
  )
}
