"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useUploads } from "@/hooks/use-uploads"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { Progress } from "@/components/ui/progress"

export function UploadHistory() {
  const uploadsQuery = useUploads()
  const uploads = uploadsQuery.data ?? []

  if (uploadsQuery.isLoading) {
    return <Skeleton className="h-72 rounded-3xl" />
  }

  if (uploadsQuery.isError) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">
        {uploadsQuery.error instanceof Error
          ? uploadsQuery.error.message
          : "Could not load uploads."}
      </div>
    )
  }

  if (!uploads.length) {
    return (
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5 text-sm text-zinc-400">
        No upload sessions yet. Drag files into the dashboard to start routing them.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {uploads.map((upload) => (
        <Card key={upload.id} className="border-white/8 bg-white/[0.02] shadow-none">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-white">{upload.originalFilename}</div>
                <div className="mt-1 text-xs text-zinc-400">
                  {upload.targetLibrary?.name || "Inbox"} • {formatRelativeDate(upload.createdAt)}
                </div>
              </div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">{upload.status}</div>
            </div>
            <Progress value={upload.progress} className="h-1.5 bg-white/[0.04]" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
