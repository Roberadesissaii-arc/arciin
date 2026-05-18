"use client"

import { useEffect } from "react"
import { motion } from "framer-motion"
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { mediaTypeIcons } from "@/lib/utils/file-icons"
import { classifyMediaType } from "@/lib/utils/media-type"
import { useUploadStore, type UploadQueueItem as UploadQueueItemModel } from "@/lib/stores/upload-store"

function statusCopy(status: UploadQueueItemModel["status"]) {
  switch (status) {
    case "QUEUED":
      return "Queued"
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

/** HTTP upload is done at 100% while the API may still report PROCESSING (thumbnails, metadata). */
function isQueueComplete(item: UploadQueueItemModel) {
  return (
    item.status === "READY" ||
    (item.status === "PROCESSING" && item.progress >= 100)
  )
}

export function UploadQueueItem({ item }: { item: UploadQueueItemModel }) {
  const removeUpload = useUploadStore((state) => state.removeUpload)

  useEffect(() => {
    const complete =
      item.status === "READY" ||
      (item.status === "PROCESSING" && item.progress >= 100)
    if (!complete) {
      return
    }
    const id = item.id
    const timer = window.setTimeout(() => {
      removeUpload(id)
    }, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [item.id, item.progress, item.status, removeUpload])

  const mediaType = classifyMediaType(item.mimeType, item.fileName)
  const FileIcon = mediaTypeIcons[mediaType] || mediaTypeIcons.DEFAULT
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
          <FileIcon className="size-4" />
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
        <div className="mt-1 shrink-0 text-zinc-600">
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
