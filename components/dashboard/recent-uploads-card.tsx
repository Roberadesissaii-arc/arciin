"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useUploads } from "@/hooks/use-uploads"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"

const statusTone: Record<string, string> = {
  QUEUED: "text-zinc-600",
  UPLOADING: "text-primary",
  PROCESSING: "text-amber-700",
  READY: "text-emerald-700",
  FAILED: "text-red-700",
}

export function RecentUploadsCard({
  embedded = false,
  tall = false,
  className,
}: {
  embedded?: boolean
  tall?: boolean
  className?: string
}) {
  const uploadsQuery = useUploads()
  const uploads = (uploadsQuery.data ?? []).slice(0, 6)

  const body = uploadsQuery.isLoading ? (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-14 rounded-xl" />
      ))}
    </div>
  ) : uploadsQuery.isError ? (
    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-800">
      {uploadsQuery.error instanceof Error
        ? uploadsQuery.error.message
        : "Could not load uploads."}
    </div>
  ) : uploads.length ? (
    <ul
      className={cn(
        "divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card",
        tall && "min-h-0 flex-1 overflow-y-auto",
      )}
    >
      {uploads.map((upload) => (
        <li
          key={upload.id}
          className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50/80"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {upload.originalFilename}
            </p>
            <p className="mt-0.5 text-xs text-zinc-600">
              <span className={statusTone[upload.status] ?? "text-zinc-600"}>
                {upload.status}
              </span>
              {" · "}
              {upload.targetLibrary?.name || "Inbox"}
            </p>
          </div>
          <time className="shrink-0 text-xs text-zinc-500">
            {formatRelativeDate(upload.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  ) : (
    <div className="rounded-2xl border border-dashed border-border bg-zinc-50/60 px-6 py-10 text-center">
      <p className="text-sm font-medium text-zinc-800">No uploads yet</p>
      <p className="mt-1 text-sm text-zinc-600">
        Drop files anywhere in the app to start routing them into your libraries.
      </p>
    </div>
  )

  const content = (
    <>
      <div className={cn(tall && "flex min-h-0 flex-1 flex-col")}>{body}</div>
      {!tall && !uploadsQuery.isLoading && uploads.length > 0 ? (
        <Link
          href="/uploads"
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80"
        >
          Upload queue
          <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </>
  )

  if (embedded) {
    return (
      <div className={cn(tall ? "flex min-h-0 flex-1 flex-col" : "space-y-0", className)}>
        {content}
      </div>
    )
  }

  return (
    <Card className={cn("border-border bg-card shadow-sm", className)}>
      <CardContent className="pt-6">{content}</CardContent>
    </Card>
  )
}
