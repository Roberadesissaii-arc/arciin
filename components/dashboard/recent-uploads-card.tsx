"use client"

import { Upload } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { dashboardStatIconShell } from "@/lib/dashboard-card-styles"
import { Skeleton } from "@/components/ui/skeleton"
import { useUploads } from "@/hooks/use-uploads"
import { formatRelativeDate } from "@/lib/utils/format-date"

export function RecentUploadsCard() {
  const uploadsQuery = useUploads()

  return (
    <Card className="border-white/8 bg-white/[0.02]">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className={dashboardStatIconShell}>
            <Upload className="size-5" />
          </div>
          <div>
            <CardTitle className="text-white">Recent uploads</CardTitle>
            <CardDescription className="text-zinc-400">
              Latest sessions moving through Arciin.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {uploadsQuery.isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-2xl" />
          ))
        ) : uploadsQuery.isError ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">
            {uploadsQuery.error instanceof Error
              ? uploadsQuery.error.message
              : "Could not load uploads."}
          </div>
        ) : (uploadsQuery.data ?? []).length ? (
          (uploadsQuery.data ?? []).slice(0, 5).map((upload) => (
            <div
              key={upload.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">
                  {upload.originalFilename}
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {upload.targetLibrary?.name || "Inbox"} • {upload.status}
                </div>
              </div>
              <div className="text-xs text-zinc-500">
                {formatRelativeDate(upload.createdAt)}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">
            No uploads yet. Drop files anywhere in the app to start routing them into your
            libraries.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
