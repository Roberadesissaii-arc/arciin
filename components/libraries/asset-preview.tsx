"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import { mediaTypeIcons } from "@/lib/utils/file-icons"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"
import { assetSupportsDocumentThumbnail } from "@arciin/shared"
import { getUserPreferences } from "@/lib/api/user-preferences"
import { queryKeys } from "@/lib/api/query-keys"
import {
  pdfThumbnailSourceKey,
  usePdfThumbnail,
} from "@/hooks/use-pdf-thumbnail"

const THUMB_MEDIA = new Set(["IMAGE", "VIDEO"])

function DocumentThumbnailPlaceholder({
  asset,
  loading = false,
}: {
  asset: AssetSummary
  loading?: boolean
}) {
  return (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 text-muted-foreground">
      <MediaTypeIcon
        mediaType={asset.mediaType}
        filename={asset.originalFilename}
        mimeType={asset.mimeType}
        extension={asset.extension}
        className={cn("size-7", loading && "arciin-doc-icon-pulse")}
      />
    </div>
  )
}

function PdfDocumentPreview({ asset }: { asset: AssetSummary }) {
  const pdfUrl = pdfThumbnailSourceKey(asset.id, asset.updatedAt)
  const thumb = usePdfThumbnail(pdfUrl, true)
  const ext = (
    asset.extension ??
    asset.originalFilename.split(".").pop() ??
    "pdf"
  ).toUpperCase()

  if (thumb) {
    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={`${asset.id}-${asset.updatedAt}`}
          src={thumb}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
        <span className="absolute bottom-1.5 right-2 rounded-md bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
          {ext}
        </span>
      </div>
    )
  }

  return <DocumentThumbnailPlaceholder asset={asset} loading />
}

function ServerAssetThumbnail({ asset }: { asset: AssetSummary }) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`

  if (thumbFailed) {
    return <DocumentThumbnailPlaceholder asset={asset} />
  }

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted/40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbSrc}
        alt=""
        className="size-full object-cover"
        loading="lazy"
        onError={() => setThumbFailed(true)}
      />
    </div>
  )
}

function ImageOrIconPreview({ asset }: { asset: AssetSummary }) {
  const { data: prefs } = useQuery({
    queryKey: queryKeys.userPreferences,
    queryFn: ({ signal }) => getUserPreferences(signal),
    staleTime: 60_000,
  })
  const docThumbs = prefs?.media.documentThumbnails ?? false
  const thumbKey = `${asset.id}-${asset.updatedAt}`

  const isPdfDoc =
    docThumbs &&
    assetSupportsDocumentThumbnail(
      asset.mediaType,
      asset.mimeType,
      asset.extension,
      asset.originalFilename,
    )

  if (isPdfDoc) {
    return <PdfDocumentPreview key={thumbKey} asset={asset} />
  }

  if (THUMB_MEDIA.has(asset.mediaType)) {
    return <ServerAssetThumbnail key={thumbKey} asset={asset} />
  }

  return <DocumentThumbnailPlaceholder asset={asset} />
}

function VideoAssetPreview({ asset }: { asset: AssetSummary }) {
  const Icon = mediaTypeIcons.VIDEO
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hover, setHover] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const videoSrc = `/api/assets/${asset.id}/download?inline=1`

  useEffect(() => {
    const el = videoRef.current
    if (!el) {
      return
    }
    if (hover) {
      void el.play().catch(() => {})
    } else {
      el.pause()
      el.currentTime = 0
    }
  }, [hover])

  return (
    <div
      className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted/40"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        src={videoSrc}
        muted
        playsInline
        loop
        preload="none"
        aria-hidden
      />
      {!thumbFailed ? (
        <div
          className={cn(
            "absolute inset-0 z-10 bg-muted/40 transition-opacity duration-200",
            hover ? "pointer-events-none opacity-0" : "opacity-100"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbSrc}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        </div>
      ) : (
        <div
          className={cn(
            "absolute inset-0 z-10 flex items-center justify-center bg-muted/80 text-muted-foreground transition-opacity duration-200",
            hover ? "pointer-events-none opacity-0" : "opacity-100"
          )}
        >
          <Icon className="size-8" />
        </div>
      )}
      <span className="sr-only">Video — hover for muted preview</span>
    </div>
  )
}

/** Inline `Content-Disposition` so `<audio>` / `<video>` can play in the page (attachment is for file downloads). */
const INLINE_DOWNLOAD = "?inline=1"

type AudioPlayMode = "idle" | "hover_preview" | "sound"

/** Hover = muted loop preview; click = play with sound (user gesture). Centered hero icon like the login panel. */
function AudioAssetPreview({ asset }: { asset: AssetSummary }) {
  const Icon = mediaTypeIcons.AUDIO
  const audioRef = useRef<HTMLAudioElement>(null)
  const hoverRef = useRef(false)
  const [playMode, setPlayMode] = useState<AudioPlayMode>("idle")
  const [thumbFailed, setThumbFailed] = useState(false)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const audioSrc = `/api/assets/${asset.id}/download${INLINE_DOWNLOAD}`

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (playMode === "sound") {
      el.muted = false
      void el.play().catch(() => {})
      return
    }
    if (playMode === "hover_preview") {
      el.muted = true
      void el.play().catch(() => {})
      return
    }
    el.pause()
    el.currentTime = 0
    el.muted = true
  }, [playMode])

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Audio preview: hover for muted preview, click to play with sound"
      className="relative aspect-[4/3] cursor-pointer overflow-hidden rounded-xl border border-border bg-gradient-to-b from-[var(--arciin-accent-soft,#fff7ed)] via-zinc-50 to-zinc-100/90 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onMouseEnter={() => {
        hoverRef.current = true
        setPlayMode((m) => (m === "sound" ? "sound" : "hover_preview"))
      }}
      onMouseLeave={() => {
        hoverRef.current = false
        setPlayMode("idle")
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setPlayMode((m) => {
          if (m === "sound") {
            return hoverRef.current ? "hover_preview" : "idle"
          }
          return "sound"
        })
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          setPlayMode((m) => {
            if (m === "sound") {
              return hoverRef.current ? "hover_preview" : "idle"
            }
            return "sound"
          })
        }
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,79,18,0.12)_0%,transparent_55%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-[18%] left-1/2 aspect-[1.35] w-[min(100%,420px)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_50%_38%,rgba(255,79,18,0.22)_0%,transparent_72%)] blur-[48px]"
        aria-hidden
      />

      <audio
        ref={audioRef}
        className="pointer-events-none absolute inset-0 h-px w-px opacity-0"
        src={audioSrc}
        playsInline
        loop
        preload="metadata"
      />

      {!thumbFailed ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-10 transition-opacity duration-200",
            playMode === "hover_preview" || playMode === "sound" ? "opacity-[0.12]" : "opacity-100",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbSrc}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 px-4 text-center">
        <Icon
          className={cn(
            "size-20 shrink-0 text-primary/90 transition-transform duration-300 sm:size-28",
            (playMode === "hover_preview" || playMode === "sound") && "scale-[1.03]",
          )}
          aria-hidden
        />
        <p className="text-[11px] font-medium leading-snug text-zinc-600 sm:text-xs">
          {playMode === "sound" ? "Click again to stop" : "Hover: muted preview · Click: play with sound"}
        </p>
      </div>

      <span className="sr-only">
        Audio — hover for muted preview, click to play with sound, click again to stop
      </span>
    </div>
  )
}

export function AssetPreview({ asset }: { asset: AssetSummary }) {
  if (asset.mediaType === "VIDEO") {
    return <VideoAssetPreview asset={asset} />
  }
  if (asset.mediaType === "AUDIO") {
    return <AudioAssetPreview asset={asset} />
  }

  return <ImageOrIconPreview asset={asset} />
}
