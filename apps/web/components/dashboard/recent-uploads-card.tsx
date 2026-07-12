"use client"

import Link from "next/link"
import {
  ChevronRight,
  Clock3,
  File,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Music4,
  type LucideIcon,
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { UploadStatusBadge } from "@/components/dashboard/upload-status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useUploads } from "@/hooks/use-uploads"
import { accentIconShellSm, accentProgressFill } from "@/lib/accent-styles"
import {
  dashboardFeedEmpty,
  dashboardFeedList,
  dashboardFeedMeta,
  dashboardFeedRow,
} from "@/lib/dashboard-card-styles"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"
import type { MediaType } from "@/lib/types/models"

const mediaTypeIcon: Partial<Record<MediaType, LucideIcon>> = {
  VIDEO: FileVideo,
  IMAGE: ImageIcon,
  AUDIO: Music4,
  DOCUMENT: FileText,
}

export function RecentUploadsCard({
  embedded = false,
  tall = false,
  fill = false,
  limit = 6,
  showLink = true,
  className,
}: {
  embedded?: boolean
  tall?: boolean
  /** Stretch the list box to the parent height (no internal scrolling). */
  fill?: boolean
  limit?: number
  showLink?: boolean
  className?: string
}) {
  const uploadsQuery = useUploads()
  const uploads = (uploadsQuery.data ?? []).slice(0, limit)

  const body = uploadsQuery.isLoading ? (
    <div className="space-y-1">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-[3.25rem] rounded-xl" />
      ))}
    </div>
  ) : uploadsQuery.isError ? (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-800">
      {uploadsQuery.error instanceof Error
        ? uploadsQuery.error.message
        : "Could not load uploads."}
    </div>
  ) : uploads.length ? (
    <div
      className={cn(
        dashboardFeedList,
        tall && "min-h-0 flex-1 overflow-y-auto",
        fill && "min-h-0 flex-1",
      )}
    >
      {uploads.map((upload) => {
        const Icon =
          (upload.detectedMediaType && mediaTypeIcon[upload.detectedMediaType]) || File
        const inProgress =
          upload.status === "UPLOADING" || upload.status === "PROCESSING"

        return (
          <div key={upload.id} className={dashboardFeedRow}>
            <div className={cn(accentIconShellSm, "mt-px size-7 rounded-lg")}>
              <Icon className="size-3.5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-zinc-900">
                  {upload.originalFilename}
                </span>
                <UploadStatusBadge status={upload.status} />
              </div>

              <p className="mt-0.5 truncate text-[12px] leading-tight text-zinc-500">
                <span className="font-medium text-zinc-600">
                  {upload.targetLibrary?.name || "Inbox"}
                </span>
                <span className="text-zinc-400"> · </span>
                {formatBytes(upload.sizeBytes)}
              </p>

              {inProgress ? (
                <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={cn("h-full rounded-full transition-all", accentProgressFill)}
                    style={{ width: `${Math.max(4, Math.min(100, upload.progress))}%` }}
                  />
                </div>
              ) : null}
            </div>

            <div className={dashboardFeedMeta}>
              <div className="flex items-center gap-1 text-[11px] font-medium text-zinc-400">
                <Clock3 className="size-3 shrink-0" />
                {formatRelativeDate(upload.createdAt)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  ) : (
    <div className={dashboardFeedEmpty}>
      <p className="text-sm font-semibold text-zinc-900">No uploads yet</p>
      <p className="mt-1 max-w-[16rem] text-sm leading-relaxed text-zinc-500">
        Drop files anywhere in the app to start routing them into your libraries.
      </p>
    </div>
  )

  const content = (
    <>
      <div className={cn((tall || fill) && "flex min-h-0 flex-1 flex-col")}>{body}</div>
      {showLink && !tall && !uploadsQuery.isLoading && uploads.length > 0 ? (
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
      <div
        className={cn(
          tall || fill ? "flex h-full min-h-0 flex-1 flex-col" : "space-y-0",
          className,
        )}
      >
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
