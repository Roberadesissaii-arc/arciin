import { toast } from "sonner"

import {
  shouldPlayUploadSound,
  shouldShowUploadCompleteToast,
  shouldShowUploadFailedToast,
} from "@/lib/preferences/notification-policy"
import { playUploadCompleteSound } from "@/lib/preferences/upload-sound"
import { recordInboxNotification } from "@/lib/notifications/record-inbox-notification"
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

  const dedupeKey = `batch:${batch.id}`

  if (batch.succeeded > 0 && batch.failed === 0) {
    const title =
      batch.total === 1 ? "Upload complete" : `${batch.succeeded} files uploaded`
    recordInboxNotification({
      title,
      message: "All files in this batch finished successfully.",
      variant: "success",
      source: "upload",
    })
    if (shouldPlayUploadSound()) void playUploadCompleteSound()
    if (shouldShowUploadCompleteToast()) {
      toast.success(title, { description: "All files in this batch finished successfully." })
    }
    return
  }

  if (batch.succeeded === 0 && batch.failed > 0) {
    const title =
      batch.total === 1 ? "Upload failed" : `${batch.failed} uploads failed`
    const description =
      batch.failures[0]?.error ??
      "See Logs → upload.log on the server for details."
    recordInboxNotification({
      title,
      message: description,
      variant: "error",
      source: "upload",
    })
    if (shouldShowUploadFailedToast()) {
      toast.error(title, { description })
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
  if (shouldShowUploadCompleteToast()) {
    toast.success(title, description ? { description } : undefined)
  }
  if (shouldShowUploadFailedToast() && batch.failed > 0) {
    toast.error(`${batch.failed} file(s) failed`, {
      description: "Open Logs and check upload.log for the full list.",
    })
  }

  void dedupeKey
}
