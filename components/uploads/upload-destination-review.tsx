"use client"

import { useMemo } from "react"

import { Badge } from "@/components/ui/badge"
import { useUploadStore } from "@/lib/stores/upload-store"

export function UploadDestinationReview() {
  const queue = useUploadStore((state) => state.queue)
  const preview = useMemo(() => queue.slice(0, 4), [queue])

  if (!preview.length) {
    return null
  }

  return (
    <div className="grid gap-2">
      {preview.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/25 px-4 py-3 text-sm"
        >
          <span className="truncate text-zinc-200">{item.fileName}</span>
          <Badge className="bg-[#FF4B33]/12 text-[#FFB08F] hover:bg-[#FF4B33]/12">
            {item.destination}
          </Badge>
        </div>
      ))}
    </div>
  )
}
