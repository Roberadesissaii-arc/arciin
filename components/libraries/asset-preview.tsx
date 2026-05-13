"use client"

import { useEffect, useRef, useState } from "react"

import { mediaTypeIcons } from "@/lib/utils/file-icons"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

const THUMB_MEDIA = new Set(["IMAGE", "VIDEO"])

function ImageOrIconPreview({ asset }: { asset: AssetSummary }) {
  const Icon = mediaTypeIcons[asset.mediaType] || mediaTypeIcons.DEFAULT
  const [thumbFailed, setThumbFailed] = useState(false)
  const tryThumb = THUMB_MEDIA.has(asset.mediaType)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`

  if (tryThumb && !thumbFailed) {
    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-white/8 bg-black/25">
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

  return (
    <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-white/8 bg-black/25 text-zinc-300">
      <Icon className="size-8" />
    </div>
  )
}

function VideoAssetPreview({ asset }: { asset: AssetSummary }) {
  const Icon = mediaTypeIcons.VIDEO
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hover, setHover] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const videoSrc = `/api/assets/${asset.id}/download`

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
      className="relative aspect-[4/3] overflow-hidden rounded-xl border border-white/8 bg-black/40"
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
            "absolute inset-0 z-10 bg-black/20 transition-opacity duration-200",
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
            "absolute inset-0 z-10 flex items-center justify-center bg-black/50 text-zinc-300 transition-opacity duration-200",
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

export function AssetPreview({ asset }: { asset: AssetSummary }) {
  if (asset.mediaType === "VIDEO") {
    return <VideoAssetPreview asset={asset} />
  }

  return <ImageOrIconPreview asset={asset} />
}
