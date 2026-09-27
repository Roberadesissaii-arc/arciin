import {
  shouldPlayUploadSound,
  shouldShowUploadCompleteToast,
  shouldShowUploadFailedToast,
} from "@/lib/preferences/notification-policy"
import { playUploadCompleteSound } from "@/lib/preferences/upload-sound"
import {
  notifyUploadComplete,
  notifyUploadFailed,
  notifyFileUploaded,
} from "@/lib/notifications/toast-actions"
import { markUploadNotifySeen } from "@/lib/notifications/notify-upload-realtime"
import { useUploadStore } from "@/lib/stores/upload-store"
import type { UploadBatchState } from "@/lib/stores/upload-store"

function logBatchFailures(batch: UploadBatchState) {
  if (batch.failures.length === 0) return
  const summary = batch.failures
    .map((f) => `• ${f.fileName}: ${f.error}`)
    .join("\n")
  console.warn(
    `[Arciin uploads] Batch finished with ${batch.failed} failure(s):\n${summary}`,
  )
}

/** One sound + summary toast when a multi-file batch completes. */
export function announceUploadBatchComplete(batch: UploadBatchState) {
  logBatchFailures(batch)

  if (batch.succeeded > 0 && batch.failed === 0) {
    const queueItem = useUploadStore
      .getState()
      .queue.find((item) => item.batchId === batch.id)
    if (shouldPlayUploadSound()) void playUploadCompleteSound()
    markUploadNotifySeen(batch.countedKeys)
    if (shouldShowUploadCompleteToast()) {
      if (batch.total === 1 && queueItem) {
        notifyFileUploaded(queueItem.fileName, queueItem.destination)
      } else {
        notifyUploadComplete(batch.succeeded, batch.total)
      }
    }
    return
  }

  if (batch.succeeded === 0 && batch.failed > 0) {
    if (shouldShowUploadFailedToast()) {
      notifyUploadFailed(undefined, batch.failures[0]?.error)
    }
    return
  }

  if (shouldPlayUploadSound()) void playUploadCompleteSound()
  markUploadNotifySeen(batch.countedKeys)
  if (shouldShowUploadCompleteToast()) {
    notifyUploadComplete(batch.succeeded, batch.total)
  }
  if (shouldShowUploadFailedToast() && batch.failed > 0) {
    notifyUploadFailed(
      batch.failures[0]?.fileName,
      batch.failures[0]?.error ?? "Some files in this batch could not be saved.",
    )
  }
}
