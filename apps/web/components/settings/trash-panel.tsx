"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Clock3,
  Loader2,
  RotateCcw,
  Trash2,
  AlertTriangle,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { FileTypePlaceholder } from "@/components/libraries/file-type-placeholder"
import {
  SectionHeader,
  SettingsCard,
} from "@/components/settings/settings-panel-primitives"
import { AppPagination } from "@/components/ui/app-pagination"
import {
  emptyTrash,
  getTrashAssets,
  permanentlyDeleteTrashAsset,
  restoreTrashAsset,
  type TrashAssetSummary,
} from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { formatMediaTypeLabel } from "@/lib/utils/media-type"
import { cn } from "@/lib/utils"
import { dashboardTablePagination } from "@/lib/dashboard-table-styles"
import { RelativeTime } from "@/components/shared/relative-time"

/** Keep Trash compact so the settings content panel stays closer to the sidebar height. */
const PAGE_SIZE = 5

function daysLabel(days: number) {
  if (days <= 0) return "Deletes today"
  if (days === 1) return "1 day left"
  return `${days} days left`
}

function TrashThumb({ item }: { item: TrashAssetSummary }) {
  const [failed, setFailed] = useState(false)
  const thumbSrc = `/api/assets/${item.id}/thumbnail?v=${encodeURIComponent(item.updatedAt)}`
  const showImage =
    !failed &&
    (item.mediaType === "IMAGE" ||
      item.mediaType === "VIDEO" ||
      item.mediaType === "DOCUMENT")

  if (!showImage) {
    return (
      <FileTypePlaceholder
        mediaType={item.mediaType}
        filename={item.originalFilename}
        mimeType={item.mimeType}
        extension={item.extension}
        className="size-full rounded-xl border-0"
        iconClassName="size-5"
      />
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbSrc}
      alt=""
      className="size-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function TrashRow({
  item,
  busyId,
  onRestore,
  onPermanent,
}: {
  item: TrashAssetSummary
  busyId: string | null
  onRestore: (id: string) => void
  onPermanent: (id: string) => void
}) {
  const busy = busyId === item.id
  const urgent = item.daysRemaining <= 3

  return (
    <div className="flex min-h-[4.75rem] flex-col gap-2.5 rounded-xl border border-zinc-200/90 bg-white px-3.5 py-3 shadow-sm sm:flex-row sm:items-center sm:gap-3.5 sm:px-4 sm:py-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-zinc-200/90 bg-zinc-100 shadow-sm sm:size-14">
          <TrashThumb item={item} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="truncate text-[14px] font-semibold leading-snug text-zinc-900" title={item.originalFilename}>
            {item.originalFilename}
          </p>
          <p className="truncate text-[12px] leading-relaxed text-zinc-500">
            <span className="font-medium text-zinc-600">{item.libraryName}</span>
            <span className="text-zinc-400"> · </span>
            {formatMediaTypeLabel(item.mediaType, {
              filename: item.originalFilename,
              mimeType: item.mimeType,
              extension: item.extension,
            })}
            <span className="text-zinc-400"> · </span>
            {formatBytes(item.sizeBytes)}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              <Clock3 className="size-3" />
              Deleted <RelativeTime value={item.deletedAt ?? item.updatedAt} />
            </span>
            <span
              className={cn(
                "inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                urgent
                  ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200/80"
                  : "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200/80",
              )}
            >
              {daysLabel(item.daysRemaining)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 border-zinc-300 bg-card px-3 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-100"
          disabled={busy}
          onClick={() => onRestore(item.id)}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
          Restore
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-9 gap-1.5 rounded-md border-0 bg-[#EF4444] px-3 text-[12px] font-semibold text-white hover:bg-[#DC2626] disabled:opacity-50"
          disabled={busy}
          onClick={() => onPermanent(item.id)}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          Delete
        </Button>
      </div>
    </div>
  )
}

export function TrashPanel() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [emptyOpen, setEmptyOpen] = useState(false)
  const [permanentTarget, setPermanentTarget] = useState<TrashAssetSummary | null>(null)

  const trashQuery = useQuery({
    queryKey: queryKeys.trash,
    queryFn: ({ signal }) => getTrashAssets(signal),
  })

  const items = trashQuery.data ?? []
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [items, safePage],
  )

  async function invalidateLibraries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.trash }),
      queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot }),
      queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activityRoot }),
      queryClient.invalidateQueries({ queryKey: queryKeys.storageSettings }),
    ])
  }

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreTrashAsset(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: async (row) => {
      toast.success("Restored from Trash", {
        description: `${row.originalFilename} is back in ${row.libraryName}.`,
      })
      await invalidateLibraries()
    },
    onError: (error: Error) => {
      toast.error("Could not restore", {
        description: error.message || "Try again in a moment.",
      })
    },
    onSettled: () => setBusyId(null),
  })

  const permanentMutation = useMutation({
    mutationFn: (id: string) => permanentlyDeleteTrashAsset(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: async () => {
      toast.success("Permanently deleted", {
        description: "The file was removed from disk and cannot be recovered.",
      })
      setPermanentTarget(null)
      await invalidateLibraries()
    },
    onError: (error: Error) => {
      toast.error("Could not delete permanently", {
        description: error.message || "Try again in a moment.",
      })
    },
    onSettled: () => setBusyId(null),
  })

  const emptyMutation = useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: async (data) => {
      toast.success("Trash emptied", {
        description:
          data.removed === 0
            ? "Trash was already empty."
            : `${data.removed} item${data.removed === 1 ? "" : "s"} permanently deleted.`,
      })
      setEmptyOpen(false)
      setPage(1)
      await invalidateLibraries()
    },
    onError: (error: Error) => {
      toast.error("Could not empty Trash", {
        description: error.message || "Try again in a moment.",
      })
    },
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 lg:min-h-full">
      <SectionHeader
        icon={Trash2}
        title="Trash"
        description="Deleted files stay here for 30 days, then Arciin permanently removes them from this server."
      />

      <SettingsCard className="shrink-0 border-zinc-200/90 bg-zinc-50/50">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <p className="text-[13px] font-semibold text-zinc-900">30-day retention</p>
            <p className="max-w-xl text-[12px] leading-relaxed text-zinc-500">
              When you delete a file from a library, it is moved here first — not wiped immediately.
              Restore it anytime within 30 days. After that, Arciin permanently deletes it from disk.
              Older deletes from before Trash existed may also show up here if they were only soft-deleted.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 gap-1.5 border-red-200 bg-white text-[12px] font-semibold text-red-700 hover:bg-red-50"
            disabled={items.length === 0 || emptyMutation.isPending}
            onClick={() => setEmptyOpen(true)}
          >
            {emptyMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <AlertTriangle className="size-3.5" />
            )}
            Empty Trash
          </Button>
        </div>
      </SettingsCard>

      {/* Fills remaining height so empty/loading match the settings sidebar. */}
      {trashQuery.isLoading ? (
        <div className="flex min-h-0 flex-1 flex-col justify-start gap-2">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <Skeleton key={i} className="h-[4.75rem] shrink-0 rounded-xl" />
          ))}
          <div className="min-h-0 flex-1 rounded-2xl border border-dashed border-zinc-200/80 bg-zinc-50/40" />
        </div>
      ) : trashQuery.isError ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50/70 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-red-800">Could not load Trash</p>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-red-700/90">
            {trashQuery.error instanceof Error
              ? trashQuery.error.message
              : "Something went wrong while loading deleted files."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4 h-9 border-red-200 bg-white text-[12px] font-semibold text-red-800 hover:bg-red-50"
            onClick={() => void trashQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
            <Trash2 className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-[14px] font-semibold text-zinc-900">Trash is empty</p>
            <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-zinc-500">
              Deleted files stay here for 30 days before permanent removal.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-zinc-500">
              {items.length} item{items.length === 1 ? "" : "s"}
              {totalPages > 1 ? ` · page ${safePage} of ${totalPages}` : ""}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {pageItems.map((item) => (
              <TrashRow
                key={item.id}
                item={item}
                busyId={busyId}
                onRestore={(id) => restoreMutation.mutate(id)}
                onPermanent={(id) => {
                  const target = items.find((row) => row.id === id) ?? null
                  setPermanentTarget(target)
                }}
              />
            ))}
            {/* Spacer so short lists still fill to the settings sidebar height */}
            <div className="min-h-0 flex-1 rounded-xl border border-transparent" aria-hidden />
          </div>

          {totalPages > 1 ? (
            <div className={cn(dashboardTablePagination, "shrink-0 px-0 pt-1")}>
              <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          ) : null}
        </div>
      )}

      <AlertDialog open={!!permanentTarget} onOpenChange={(open) => !open && setPermanentTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              {permanentTarget
                ? `${permanentTarget.originalFilename} will be removed from this server forever. This cannot be undone.`
                : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={permanentMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              className="bg-[#EF4444] text-white hover:bg-[#DC2626]"
              disabled={permanentMutation.isPending || !permanentTarget}
              onClick={() => permanentTarget && permanentMutation.mutate(permanentTarget.id)}
            >
              {permanentMutation.isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : null}
              Delete forever
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={emptyOpen} onOpenChange={setEmptyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete all {items.length} item{items.length === 1 ? "" : "s"} in Trash.
              Files will be removed from disk and cannot be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emptyMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              className="bg-[#EF4444] text-white hover:bg-[#DC2626]"
              disabled={emptyMutation.isPending}
              onClick={() => emptyMutation.mutate()}
            >
              {emptyMutation.isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : null}
              Empty Trash
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
