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
  uploadBatchFailedCopy,
} from "@/lib/notifications/toast-actions"
import { markUploadNotifySeen } from "@/lib/notifications/notify-upload-realtime"
import { recordInboxNotification } from "@/lib/notifications/record-inbox-notification"
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
    const copy =
      batch.total === 1
        ? {
            title: "File uploaded",
            message: queueItem
              ? `${queueItem.fileName} was saved on the server.`
              : "Your file was saved on the server.",
          }
        : {
            title: `${batch.succeeded} files uploaded`,
            message: `All ${batch.succeeded} files were saved on your server.`,
          }
    recordInboxNotification({
      title: copy.title,
      message: copy.message,
      variant: "success",
      source: "upload",
    })
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
    const failCopy = uploadBatchFailedCopy(batch.failures[0]?.error)
    recordInboxNotification({
      title: failCopy.title,
      message: failCopy.description,
      variant: "error",
      source: "upload",
    })
    if (shouldShowUploadFailedToast()) {
      notifyUploadFailed(undefined, batch.failures[0]?.error)
    }
    return
  }

  const title = `${batch.succeeded} uploaded, ${batch.failed} failed`
  const description =
    batch.failures.length > 0
      ? `${batch.failures[0]!.fileName}: ${batch.failures[0]!.error}${
          batch.failures.length > 1 ? ` (+${batch.failures.length - 1} more — see upload.log)` : ""
        }`
      : undefined

  recordInboxNotification({
    title,
    message: description,
    variant: "warning",
    source: "upload",
  })
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
