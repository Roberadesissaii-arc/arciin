"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { File, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getAssets, getAssetsByIds } from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"
import { ASSET_API_BASE, fmtBytes } from "@/components/chat/chat-format"

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

function chatListAssetFilters(mediaType: string): { mediaType?: string; category?: "code" | "applications" } {
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
      <div
        className={cn(
          "grid gap-1.5",
          shown.length === 1 ? "grid-cols-1 max-w-[200px]" : "grid-cols-2 sm:grid-cols-3",
        )}
      >
        {shown.map((asset) => {
        const hasThumbnail = asset.mediaType === "IMAGE" || asset.mediaType === "VIDEO"
        const thumbUrl = `${ASSET_API_BASE}/assets/${asset.id}/thumbnail`
        return (
          <div
            key={asset.id}
            className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30 hover:bg-primary/[0.03]"
          >
            <div className="relative aspect-video overflow-hidden bg-muted/50">
              {hasThumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                  <File className="size-5" />
                </div>
              )}
            </div>
            <div className="px-2.5 py-2">
              <p className="truncate text-[11px] font-medium text-foreground">{asset.originalFilename}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="rounded bg-muted px-1 py-px font-mono text-[10px] uppercase text-muted-foreground">
                  {asset.extension}
                </span>
                <span className="text-[10px] text-muted-foreground">{fmtBytes(asset.sizeBytes)}</span>
              </div>
            </div>
          </div>
        )
      })}
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

  const assets = query.data ?? []
  if (!assets.length) {
    return (
      <p className="my-2 text-[13px] text-muted-foreground">No {mediaType} in this library.</p>
    )
  }

  const shown = expanded ? assets : assets.slice(0, CHAT_FILENAME_LIST_PREVIEW)
  const remainder = expanded ? 0 : Math.max(0, assets.length - CHAT_FILENAME_LIST_PREVIEW)

  return (
    <div className="my-2 rounded-xl border border-border bg-muted/20 px-4 py-3">
      <ul className="list-none space-y-1">
        {shown.map((asset) => (
          <li key={asset.id} className="flex items-baseline gap-2 text-[13px] leading-snug text-foreground">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-zinc-400" />
            <span className="min-w-0 flex-1 break-words">{asset.originalFilename}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {fmtBytes(asset.sizeBytes)}
            </span>
          </li>
        ))}
      </ul>
      {remainder > 0 || expanded ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 h-8 w-full border-border text-[11px] font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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

  const assets = query.data ?? []

  if (!assets.length) {
    return (
      <div className="my-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-[12px] text-muted-foreground">
        No {mediaType} found.
      </div>
    )
  }

  const cap = Math.min(limit + extraPages * CHAT_ASSET_GRID_PAGE, assets.length)
  const shown = assets.slice(0, cap)
  const remaining = assets.length - cap

  return (
    <div className="my-2 space-y-2">
      <div
        className={cn(
          "grid gap-1.5",
          shown.length === 1 ? "grid-cols-1 max-w-[200px]" : "grid-cols-2 sm:grid-cols-3",
        )}
      >
        {shown.map((asset) => {
        const hasThumbnail = asset.mediaType === "IMAGE" || asset.mediaType === "VIDEO"
        const thumbUrl = `${ASSET_API_BASE}/assets/${asset.id}/thumbnail`
        return (
          <div
            key={asset.id}
            className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30 hover:bg-primary/[0.03]"
          >
            <div className="relative aspect-video overflow-hidden bg-muted/50">
              {hasThumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"
                    const fallback = e.currentTarget.nextElementSibling as HTMLElement | null
                    if (fallback) fallback.hidden = false
                  }}
                />
              ) : null}
              <div
                hidden={hasThumbnail}
                className="flex h-full w-full items-center justify-center text-muted-foreground/40"
              >
                <File className="size-5" />
              </div>
            </div>
            <div className="px-2.5 py-2">
              <p className="truncate text-[11px] font-medium text-foreground">
                {asset.originalFilename}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="rounded bg-muted px-1 py-px font-mono text-[10px] uppercase text-muted-foreground">
                  {asset.extension}
                </span>
                <span className="text-[10px] text-muted-foreground">{fmtBytes(asset.sizeBytes)}</span>
              </div>
            </div>
          </div>
        )
      })}
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
