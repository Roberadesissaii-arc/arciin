"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  Clock3,
  File,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Music4,
  RefreshCw,
  Upload,
  type LucideIcon,
} from "lucide-react"

import { UploadStatusBadge } from "@/components/dashboard/upload-status-badge"
import { AppPagination } from "@/components/ui/app-pagination"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useUploads } from "@/hooks/use-uploads"
import {
  dashboardTableBodyRow,
  dashboardTableHeadCell,
  dashboardTableHeadRow,
  dashboardTablePagination,
  dashboardTablePanel,
  dashboardTablePanelHeader,
} from "@/lib/dashboard-table-styles"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"
import type { MediaType, UploadSessionSummary } from "@/lib/types/models"

const PAGE_SIZE = 12

const mediaTypeIcon: Partial<Record<MediaType, LucideIcon>> = {
  VIDEO: FileVideo,
  IMAGE: ImageIcon,
  AUDIO: Music4,
  DOCUMENT: FileText,
}

const LIBRARY_ROUTES: Record<string, string> = {
  inbox: "/inbox",
  videos: "/videos",
  images: "/images",
  music: "/music",
  documents: "/documents",
}

function UploadTableRow({ upload }: { upload: UploadSessionSummary }) {
  const Icon =
    (upload.detectedMediaType && mediaTypeIcon[upload.detectedMediaType]) || File
  const inProgress =
    upload.status === "UPLOADING" || upload.status === "PROCESSING"
  const librarySlug = upload.targetLibrary?.slug
  const libraryHref =
    librarySlug && LIBRARY_ROUTES[librarySlug] ? LIBRARY_ROUTES[librarySlug] : "/files"
  const libraryName = upload.targetLibrary?.name || "Inbox"

  return (
    <TableRow className={cn(dashboardTableBodyRow, "[&>td]:align-middle [&>td]:py-3.5")}>
      <TableCell className="whitespace-nowrap py-3.5 pl-5 text-[13px] tabular-nums text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
          {formatRelativeDate(upload.createdAt)}
        </span>
      </TableCell>
      <TableCell className="max-w-0 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600">
            <Icon className="size-3.5" aria-hidden />
          </span>
          <span
            className="block min-w-0 truncate text-[13px] font-medium text-zinc-900"
            title={upload.originalFilename}
          >
            {upload.originalFilename}
          </span>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5">
        <UploadStatusBadge status={upload.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5">
        <Link
          href={libraryHref}
          className="text-[13px] font-medium text-zinc-700 transition-colors hover:text-primary"
        >
          {libraryName}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap py-3.5 text-[13px] tabular-nums text-zinc-600">
        {formatBytes(upload.sizeBytes)}
      </TableCell>
      <TableCell className="min-w-[7rem] py-3.5 pr-5">
        {inProgress ? (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.max(4, Math.min(100, upload.progress))}%` }}
              />
            </div>
            <p className="text-[11px] font-medium tabular-nums text-zinc-500">
              {Math.round(upload.progress)}%
            </p>
          </div>
        ) : upload.error ? (
          <span
            className="block max-w-[10rem] truncate text-[12px] text-red-600"
            title={upload.error}
          >
            {upload.error}
          </span>
        ) : (
          <span className="text-[13px] text-zinc-400">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

export function UploadsSessionsTable() {
  const [page, setPage] = useState(1)
  const uploadsQuery = useUploads()

  const all = useMemo(() => uploadsQuery.data ?? [], [uploadsQuery.data])
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  if (uploadsQuery.isLoading) {
    return (
      <div className={dashboardTablePanel}>
        <div className={dashboardTablePanelHeader}>
          <Upload className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Upload sessions</span>
        </div>
        <div className="space-y-0 px-5 py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="my-3 h-12 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (uploadsQuery.isError) {
    return (
      <p className="rounded-2xl border border-red-500/25 bg-red-50 px-5 py-10 text-center text-sm text-red-600">
        {uploadsQuery.error instanceof Error
          ? uploadsQuery.error.message
          : "Could not load upload sessions."}
      </p>
    )
  }

  return (
    <div className={dashboardTablePanel}>
      <div className={dashboardTablePanelHeader}>
        <Upload className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Upload sessions</span>
        <div className="ml-auto flex items-center gap-2">
          {all.length > 0 ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {all.length} session{all.length === 1 ? "" : "s"}
              {totalPages > 1 ? ` · page ${safePage} of ${totalPages}` : ""}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-border bg-card text-xs font-semibold text-foreground"
            onClick={() => uploadsQuery.refetch()}
            disabled={uploadsQuery.isFetching}
          >
            <RefreshCw className={`size-3.5 ${uploadsQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {all.length === 0 ? (
        <Empty className="rounded-none border-0 py-12">
          <EmptyMedia variant="icon">
            <Upload />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No uploads yet</EmptyTitle>
            <EmptyDescription>
              Drop files anywhere in the app. Sessions appear here as they classify and route into
              libraries.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table className="w-full min-w-0 table-fixed">
            <colgroup>
              <col style={{ width: "14%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <TableHeader>
              <TableRow className={dashboardTableHeadRow}>
                <TableHead className={cn(dashboardTableHeadCell, "pl-5")}>Time</TableHead>
                <TableHead className={dashboardTableHeadCell}>File</TableHead>
                <TableHead className={dashboardTableHeadCell}>Status</TableHead>
                <TableHead className={dashboardTableHeadCell}>Library</TableHead>
                <TableHead className={dashboardTableHeadCell}>Size</TableHead>
                <TableHead className={cn(dashboardTableHeadCell, "pr-5")}>Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((upload) => (
                <UploadTableRow key={upload.id} upload={upload} />
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 ? (
            <div className={dashboardTablePagination}>
              <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
