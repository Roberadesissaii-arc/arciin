"use client"

import { useCallback, useEffect, useState } from "react"
import { motion } from "framer-motion"
import { AlertCircle, CheckCircle2, LoaderCircle, X } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { useCancelUpload } from "@/hooks/use-uploads"
import { classifyMediaType, mediaTypeFromDestinationLabel } from "@/lib/utils/media-type"
import { useUploadStore, type UploadQueueItem as UploadQueueItemModel } from "@/lib/stores/upload-store"

function statusCopy(status: UploadQueueItemModel["status"]) {
  switch (status) {
    case "QUEUED":
      return "Waiting to start"
    case "UPLOADING":
      return "Uploading"
    case "UPLOADED":
      return "Uploaded"
    case "ANALYZING":
      return "Analyzing"
    case "CLASSIFIED":
      return "Classified"
    case "PROCESSING":
      return "Processing"
    case "READY":
      return "Ready"
    case "FAILED":
      return "Failed"
  }
}

const AUTO_DISMISS_MS = 3800

/** Saved on server — show done checkmark (88%+ while worker finishes thumbnails). */
function isQueueComplete(item: UploadQueueItemModel) {
  return (
    item.status === "READY" ||
    (item.status === "PROCESSING" && item.progress >= 88)
  )
}

function canCancelItem(item: UploadQueueItemModel) {
  return item.status !== "READY" && item.status !== "FAILED" && !isQueueComplete(item)
}

function canDismissItem(item: UploadQueueItemModel) {
  return canCancelItem(item) || item.status === "FAILED"
}

export function UploadQueueItem({ item }: { item: UploadQueueItemModel }) {
  const removeUpload = useUploadStore((state) => state.removeUpload)
  const updateStatus = useUploadStore((state) => state.updateStatus)
  const cancelUploadMutation = useCancelUpload()
  const [cancelling, setCancelling] = useState(false)

  const handleCancel = useCallback(async () => {
    if (cancelling) return

    if (item.status === "FAILED") {
      removeUpload(item.id)
      return
    }

    setCancelling(true)
    try {
      if (item.uploadId) {
        await cancelUploadMutation.mutateAsync(item.uploadId)
        updateStatus(item.id, "FAILED", "Cancelled.")
      } else {
        updateStatus(item.id, "FAILED", "Cancelled.")
      }
    } catch {
      updateStatus(item.id, "FAILED", "Cancelled.")
    } finally {
      window.setTimeout(() => removeUpload(item.id), 400)
      setCancelling(false)
    }
  }, [cancelUploadMutation, cancelling, item.id, item.status, item.uploadId, removeUpload, updateStatus])

  useEffect(() => {
    const complete = isQueueComplete(item)
    if (!complete) {
      return
    }
    const id = item.id
    const timer = window.setTimeout(() => {
      removeUpload(id)
    }, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  // isQueueComplete reads item.status and item.progress and nothing else, and
  // both are listed. Depending on `item` would restart the dismissal timer on
  // every field that changes during an upload, so a finished item would never
  // dismiss.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.progress, item.status, removeUpload])

  const mediaType =
    mediaTypeFromDestinationLabel(item.destination) ??
    classifyMediaType(item.mimeType, item.fileName)
  const failureDetail = item.error?.trim() || "No details were returned. Check Logs → upload.log on the server."

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      className="rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-sm ring-1 ring-black/[0.04]"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-100 text-zinc-600">
          <MediaTypeIcon
            mediaType={mediaType}
            filename={item.fileName}
            mimeType={item.mimeType}
            className="size-4"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-900">{item.fileName}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-600">
            <span>{item.destination}</span>
            <span className="size-1 shrink-0 rounded-full bg-zinc-400" />
            <span>{statusCopy(item.status)}</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Progress value={item.progress} className="h-1.5 flex-1 bg-zinc-200" />
            <span className="w-11 shrink-0 text-right text-xs font-medium tabular-nums text-zinc-700">
              {item.status === "FAILED" ? "—" : `${Math.min(100, Math.max(0, Math.round(item.progress)))}%`}
            </span>
          </div>
          {item.error ? (
            <p className="mt-2 line-clamp-3 text-xs font-medium text-red-700" title={item.error}>
              {item.error}
            </p>
          ) : null}
        </div>
        <div className="mt-1 shrink-0 flex flex-col items-end gap-1 text-zinc-600">
          {canDismissItem(item) ? (
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={cancelling}
              className="rounded-md p-0.5 text-zinc-500 outline-none transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
              aria-label={item.status === "FAILED" ? `Dismiss ${item.fileName}` : `Cancel ${item.fileName}`}
              title={item.status === "FAILED" ? "Dismiss" : "Cancel upload"}
            >
              <X className="size-4" />
            </button>
          ) : null}
          {item.status === "FAILED" ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded-md p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    aria-label={`Why ${item.fileName} failed`}
                  >
                    <AlertCircle className="size-4 text-red-600" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="left"
                  className="max-w-[min(20rem,calc(100vw-2rem))] text-left text-xs leading-relaxed"
                >
                  {failureDetail}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : isQueueComplete(item) ? (
            <CheckCircle2 className="size-4 text-emerald-600" />
          ) : (
            <LoaderCircle className="size-4 animate-spin text-primary" />
          )}
        </div>
      </div>
    </motion.div>
  )
}
