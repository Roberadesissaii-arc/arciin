"use client"

import { useEffect } from "react"
import { motion } from "framer-motion"
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import { mediaTypeIcons } from "@/lib/utils/file-icons"
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

export function UploadQueueItem({ item }: { item: UploadQueueItemModel }) {
  const removeUpload = useUploadStore((state) => state.removeUpload)

  useEffect(() => {
    if (item.status !== "READY") {
      return
    }
    const id = item.id
    const timer = window.setTimeout(() => {
      removeUpload(id)
    }, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [item.id, item.status, removeUpload])

  const mediaType =
    item.destination === "Videos"
      ? "VIDEO"
      : item.destination === "Images"
        ? "IMAGE"
        : item.destination === "Music"
          ? "AUDIO"
          : item.destination === "Documents"
            ? "DOCUMENT"
            : "OTHER"
  const FileIcon = mediaTypeIcons[mediaType] || mediaTypeIcons.DEFAULT

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      className="rounded-2xl border border-white/[0.08] bg-[#121218]/90 p-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-white/[0.04] text-zinc-300">
          <FileIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{item.fileName}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
            <span>{item.destination}</span>
            <span className="size-1 rounded-full bg-zinc-700" />
            <span>{statusCopy(item.status)}</span>
          </div>
          <Progress
            value={item.progress}
            className="mt-3 h-1.5 bg-white/[0.04]"
          />
          {item.error ? (
            <div className="mt-2 text-xs text-red-300">{item.error}</div>
          ) : null}
        </div>
        <div className="mt-1 text-zinc-400">
          {item.status === "FAILED" ? (
            <AlertCircle className="size-4 text-red-400" />
          ) : item.status === "READY" ? (
            <CheckCircle2 className="size-4 text-emerald-400" />
          ) : (
            <LoaderCircle className="size-4 animate-spin text-[#FF8F66]" />
          )}
        </div>
      </div>
    </motion.div>
  )
}
