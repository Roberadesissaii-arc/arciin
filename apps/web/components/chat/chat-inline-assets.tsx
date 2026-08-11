"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, File, FileText, Loader2, Music, Paperclip, Video } from "lucide-react"

import { useChatAttach } from "@/components/chat/chat-attach-context"
import { Button } from "@/components/ui/button"
import { getAssets, getAssetsByIds } from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"
import { ASSET_API_BASE, fmtBytes } from "@/components/chat/chat-format"
import type { AssetSummary } from "@/lib/types/models"
import { isAttachableMediaType } from "@/components/chat/chat-composer-attachments"

// ── Inline asset cards ─────────────────────────────────────────────────────────

const MEDIA_TYPE_MAP: Record<string, string> = {
  images: "IMAGE",
  videos: "VIDEO",
  music: "AUDIO",
  documents: "DOCUMENT",
  code: "CODE",
  python: "CODE",
  py: "CODE",
  applications: "APPLICATION",
  apps: "APPLICATION",
}

function chatListAssetFilters(mediaType: string): {
  mediaType?: string
  category?: "code" | "applications"
} {
  if (mediaType === "code" || mediaType === "python" || mediaType === "py") {
    return { category: "code" }
  }
  if (mediaType === "applications" || mediaType === "apps") {
    return { category: "applications" }
  }
  const mapped = MEDIA_TYPE_MAP[mediaType]
  return mapped ? { mediaType: mapped } : {}
}

/** How many file rows / cards to show before "Show more" in chat previews. */
const CHAT_FILENAME_LIST_PREVIEW = 10
const CHAT_ASSET_GRID_PREVIEW_IDS = 6
const CHAT_ASSET_GRID_PAGE = 12

/** Types that often have generated thumbnails (PDF covers, image/video stills). */
function assetMayHaveThumbnail(asset: Pick<AssetSummary, "mediaType" | "extension" | "mimeType">): boolean {
  if (asset.mediaType === "IMAGE" || asset.mediaType === "VIDEO") return true
  if (asset.mediaType === "DOCUMENT") return true
  const ext = (asset.extension || "").toLowerCase().replace(/^\./, "")
  if (["pdf", "epub", "png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mkv", "mov"].includes(ext)) {
    return true
  }
  if (/^(image|video)\//i.test(asset.mimeType || "")) return true
  if (asset.mimeType === "application/pdf") return true
  return false
}

function FallbackIcon({
  mediaType,
  className,
}: {
  mediaType?: string
  className?: string
}) {
  if (mediaType === "VIDEO") return <Video className={className} aria-hidden />
  if (mediaType === "AUDIO") return <Music className={className} aria-hidden />
  if (mediaType === "DOCUMENT") return <FileText className={className} aria-hidden />
  return <File className={className} aria-hidden />
}

/**
 * Tries the asset thumbnail endpoint; falls back to a type icon when missing/404.
 */
function AssetThumbnail({
  asset,
  className,
  imgClassName,
  iconClassName = "size-5",
}: {
  asset: Pick<AssetSummary, "id" | "mediaType" | "extension" | "mimeType" | "updatedAt" | "originalFilename">
  className?: string
  imgClassName?: string
  iconClassName?: string
}) {
  const [failed, setFailed] = useState(false)
  const tryThumb = assetMayHaveThumbnail(asset) && !failed
  const thumbUrl = `${ASSET_API_BASE}/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`

  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden bg-muted/50", className)}>
      {tryThumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt=""
          className={cn("h-full w-full object-cover", imgClassName)}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/45">
          <FallbackIcon mediaType={asset.mediaType} className={iconClassName} />
        </div>
      )}
    </div>
  )
}

function useSelectableAsset(asset: AssetSummary) {
  const attach = useChatAttach()
  const selected = Boolean(attach?.attachedIds.has(asset.id))
  const busy = attach?.busyAssetId === asset.id
  const canAttach = Boolean(attach && isAttachableMediaType(asset.mediaType))

  const onSelect = () => {
    if (!attach || !canAttach || busy) return
    void attach.attachAsset(asset)
  }

  return { attach, selected, busy, canAttach, onSelect }
}

function isDocumentLike(asset: AssetSummary): boolean {
  return (
    asset.mediaType === "DOCUMENT" ||
    /\.pdf$/i.test(asset.originalFilename) ||
    asset.mimeType === "application/pdf"
  )
}


/**
 * Card sizing for the asset grids.
 *
 * Fixed column counts (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4`) tie card
 * width to panel width, so in a wide chat the four columns stretched a book
 * cover to ~300px across and ~450px tall — one PDF filled the screen.
 *
 * `auto-fill` with a bounded track inverts that: the card keeps a sensible size
 * and the *number* of columns absorbs the extra width. A wide panel gets more
 * covers per row instead of bigger covers, and a narrow one still gets two.
 */
const COVER_GRID = "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]"
const FILE_GRID = "grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]"

function SelectableAssetCard({
  asset,
  coverStyle = false,
}: {
  asset: AssetSummary
  /** Book/PDF portrait cover (taller) instead of landscape video frame. */
  coverStyle?: boolean
}) {
  const { selected, busy, canAttach, onSelect } = useSelectableAsset(asset)
  const useCover = coverStyle || isDocumentLike(asset)

  return (
    <button
      type="button"
      disabled={!canAttach || busy}
      onClick={onSelect}
      title={
        canAttach
          ? selected
            ? "Already attached — ask a follow-up in the composer"
            : "Attach to message — then ask a follow-up or /summarize"
          : "This file type can't be attached here"
      }
      className={cn(
        "group flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left transition-colors",
        selected
          ? "border-primary/50 bg-primary/[0.06] ring-1 ring-primary/30"
          : "border-border hover:border-primary/30 hover:bg-primary/[0.03]",
        canAttach ? "cursor-pointer" : "cursor-default opacity-80",
        busy && "opacity-70",
      )}
    >
      <div className="relative">
        <AssetThumbnail
          asset={asset}
          className={cn("w-full", useCover ? "aspect-[2/3]" : "aspect-video")}
          imgClassName={useCover ? "object-cover object-top" : undefined}
        />
        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : selected ? (
          <div className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-white shadow">
            <Check className="size-3.5" strokeWidth={2.5} />
          </div>
        ) : canAttach ? (
          <div className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground opacity-0 shadow transition-opacity group-hover:opacity-100">
            <Paperclip className="size-3" />
          </div>
        ) : null}
      </div>
      <div className="px-2.5 py-2">
        <p className="line-clamp-2 text-[11px] font-medium leading-snug text-foreground">
          {asset.title?.trim() || asset.originalFilename}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="rounded bg-muted px-1 py-px font-mono text-[10px] uppercase text-muted-foreground">
            {asset.extension}
          </span>
          <span className="text-[10px] text-muted-foreground">{fmtBytes(asset.sizeBytes)}</span>
        </div>
      </div>
    </button>
  )
}

function SelectableAssetRow({ asset }: { asset: AssetSummary }) {
  const { selected, busy, canAttach, onSelect } = useSelectableAsset(asset)

  return (
    <li>
      <button
        type="button"
        disabled={!canAttach || busy}
        onClick={onSelect}
        title={
          canAttach
            ? selected
              ? "Already attached — ask a follow-up in the composer"
              : "Attach to message — then ask a follow-up or /summarize"
            : "This file type can't be attached here"
        }
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors",
          selected
            ? "bg-primary/10 ring-1 ring-primary/30"
            : "hover:bg-muted/40",
          canAttach ? "cursor-pointer" : "cursor-default opacity-80",
          busy && "opacity-70",
        )}
      >
        <div className="relative shrink-0">
          <AssetThumbnail
            asset={asset}
            className="size-11 rounded-md border border-border/60 shadow-sm sm:size-12"
            iconClassName="size-4"
          />
          {busy ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/50">
              <Loader2 className="size-4 animate-spin text-primary" />
            </div>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-snug text-foreground">
            {asset.title?.trim() || asset.originalFilename}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="rounded bg-muted px-1 py-px font-mono text-[10px] uppercase text-muted-foreground">
              {asset.extension}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {fmtBytes(asset.sizeBytes)}
            </span>
          </div>
        </div>
        {selected ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
            <Check className="size-3.5" strokeWidth={2.5} />
          </span>
        ) : canAttach ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
            <Paperclip className="size-3" />
          </span>
        ) : null}
      </button>
    </li>
  )
}

export function InlineAssetBlockByIds({ assetIds }: { assetIds: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const query = useQuery({
    queryKey: queryKeys.assets({ _chatIds: assetIds.join(",") }),
    queryFn: ({ signal }) => getAssetsByIds(assetIds, signal),
    enabled: assetIds.length > 0,
    staleTime: 30_000,
  })

  if (query.isLoading) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading matches…
      </div>
    )
  }

  const assets = query.data ?? []
  if (!assets.length) {
    return (
      <div className="my-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        Matched images are no longer available.
      </div>
    )
  }

  const shown = expanded ? assets : assets.slice(0, CHAT_ASSET_GRID_PREVIEW_IDS)
  const hidden = Math.max(0, assets.length - CHAT_ASSET_GRID_PREVIEW_IDS)

  return (
    <div className="my-2 space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Tap a file to attach it — then ask a follow-up or use /summarize.
      </p>
      <div
        className={cn(
          shown.length === 1 ? "grid max-w-[11rem] grid-cols-1 gap-1.5" : FILE_GRID,
        )}
      >
        {shown.map((asset) => (
          <SelectableAssetCard key={asset.id} asset={asset} />
        ))}
      </div>
      {hidden > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full border-border text-[11px] font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show fewer" : `Show ${hidden} more (${assets.length} total)`}
        </Button>
      ) : null}
    </div>
  )
}

/** Document/book (and general) list — books/PDFs use cover grid; others stay as rows. */
export function InlineAssetFilenameList({ mediaType }: { mediaType: string }) {
  const [expanded, setExpanded] = useState(false)
  const filter = chatListAssetFilters(mediaType)
  const query = useQuery({
    queryKey: queryKeys.assets({ ...filter, _chatList: mediaType }),
    queryFn: ({ signal }) => getAssets(filter, signal),
    staleTime: 30_000,
  })

  if (query.isLoading) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading file list…
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="my-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        Could not load {mediaType}.{" "}
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </div>
    )
  }

  const assets = query.data ?? []
  if (!assets.length) {
    return (
      <p className="my-2 text-[13px] text-muted-foreground">No {mediaType} in this library.</p>
    )
  }

  const isDocs =
    mediaType === "documents" ||
    mediaType === "books" ||
    mediaType === "pdfs" ||
    assets.some((a) => isDocumentLike(a))

  // Books / PDFs → cover grid so first-page previews are obvious.
  if (isDocs && (mediaType === "documents" || mediaType === "books" || mediaType === "pdfs" || mediaType === "all")) {
    const preview = 12
    const shown = expanded ? assets : assets.slice(0, preview)
    const remainder = expanded ? 0 : Math.max(0, assets.length - preview)
    return (
      <div className="my-2 space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Cover previews when available — tap a book to attach, then /summarize or ask a follow-up.
        </p>
        <div className={COVER_GRID}>
          {shown.map((asset) => (
            <SelectableAssetCard key={asset.id} asset={asset} coverStyle />
          ))}
        </div>
        {remainder > 0 || expanded ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full border-border text-[11px] font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? "Show fewer"
              : `Show ${remainder} more (${assets.length.toLocaleString()} total)`}
          </Button>
        ) : null}
      </div>
    )
  }

  const shown = expanded ? assets : assets.slice(0, CHAT_FILENAME_LIST_PREVIEW)
  const remainder = expanded ? 0 : Math.max(0, assets.length - CHAT_FILENAME_LIST_PREVIEW)

  return (
    <div className="my-2 rounded-xl border border-border bg-muted/20 px-2 py-2 sm:px-3 sm:py-2.5">
      <p className="mb-1.5 px-1.5 text-[11px] text-muted-foreground">
        Tap a file to attach it — then ask a follow-up or use /summarize.
      </p>
      <ul className="list-none space-y-1">
        {shown.map((asset) => (
          <SelectableAssetRow key={asset.id} asset={asset} />
        ))}
      </ul>
      {remainder > 0 || expanded ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-8 w-full border-border text-[11px] font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? "Show fewer"
            : `Show ${remainder} more (${assets.length.toLocaleString()} total)`}
        </Button>
      ) : null}
    </div>
  )
}

export function InlineAssetBlock({ mediaType, limit = 9 }: { mediaType: string; limit?: number }) {
  const [extraPages, setExtraPages] = useState(0)
  const filter = chatListAssetFilters(mediaType)
  const query = useQuery({
    queryKey: queryKeys.assets({ ...filter, _chatBlock: mediaType }),
    queryFn: ({ signal }) => getAssets(filter, signal),
    staleTime: 30_000,
  })

  if (query.isLoading) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading {mediaType}…
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="my-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        Could not load {mediaType}.{" "}
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </div>
    )
  }

  const assets = query.data ?? []

  if (!assets.length) {
    return (
      <div className="my-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        No {mediaType} found.
      </div>
    )
  }

  const isDocs = mediaType === "documents" || mediaType === "books" || mediaType === "pdfs"
  // Books need more covers visible at once.
  const effectiveLimit = isDocs ? Math.max(limit, 12) : limit
  const cap = Math.min(effectiveLimit + extraPages * CHAT_ASSET_GRID_PAGE, assets.length)
  const shown = assets.slice(0, cap)
  const remaining = assets.length - cap

  return (
    <div className="my-2 space-y-2">
      <p className="text-[11px] text-muted-foreground">
        {isDocs
          ? "Cover previews when available — tap a book to attach, then /summarize or ask a follow-up."
          : "Tap a file to attach it — then ask a follow-up or use /summarize."}
      </p>
      <div
        className={cn(
          shown.length === 1
            ? "grid max-w-[9.5rem] grid-cols-1 gap-2"
            : isDocs
              ? COVER_GRID
              : FILE_GRID,
        )}
      >
        {shown.map((asset) => (
          <SelectableAssetCard key={asset.id} asset={asset} coverStyle={isDocs} />
        ))}
      </div>
      {remaining > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full border-border text-[11px] font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          onClick={() => setExtraPages((p) => p + 1)}
        >
          Show {Math.min(remaining, CHAT_ASSET_GRID_PAGE)} more ({remaining.toLocaleString()} left)
        </Button>
      ) : extraPages > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full border-border text-[11px] font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          onClick={() => setExtraPages(0)}
        >
          Show fewer
        </Button>
      ) : null}
    </div>
  )
}
