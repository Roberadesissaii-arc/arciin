"use client"

import { useEffect, useRef, useState } from "react"
import { Video } from "lucide-react"

import { VideoDurationBadge, videoDurationLabel } from "@/components/libraries/video-duration-badge"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

/** Muted loop preview on hover — used in library cards and dashboard uploads. */
export function VideoHoverThumb({
  asset,
  className,
  children,
  showDuration = false,
}: {
  asset: AssetSummary
  className?: string
  children?: React.ReactNode
  /** Show length badge (bottom-right); probes metadata when DB value is missing. */
  showDuration?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hover, setHover] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  const [probedDuration, setProbedDuration] = useState<number | null>(null)
  const thumbSrc = `/api/assets/${asset.id}/thumbnail?v=${encodeURIComponent(asset.updatedAt)}`
  const videoSrc = `/api/assets/${asset.id}/download?inline=1&v=${encodeURIComponent(asset.updatedAt)}`

  const needsDurationProbe =
    showDuration &&
    asset.mediaType === "VIDEO" &&
    (asset.durationSeconds == null || asset.durationSeconds <= 0)

  const durationLabel = videoDurationLabel(asset.durationSeconds ?? probedDuration)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop-sync: clear the stale probe when the asset identity changes.
    setProbedDuration(null)
  }, [asset.id, asset.durationSeconds])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    if (hover) {
      void el.play().catch(() => {})
    } else {
      el.pause()
      el.currentTime = 0
    }
  }, [hover])

  function captureDurationFromVideo() {
    const el = videoRef.current
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return
    if (asset.durationSeconds != null && asset.durationSeconds > 0) return
    setProbedDuration(el.duration)
  }

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        src={videoSrc}
        draggable={false}
        muted
        playsInline
        loop
        preload={needsDurationProbe ? "metadata" : "none"}
        onLoadedMetadata={needsDurationProbe ? captureDurationFromVideo : undefined}
        aria-hidden
      />
      {!thumbFailed ? (
        <div
          className={cn(
            "absolute inset-0 z-10 transition-opacity duration-200",
            hover ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbSrc}
            alt=""
            draggable={false}
            className="size-full object-cover"
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        </div>
      ) : (
        <div
          className={cn(
            "absolute inset-0 z-10 flex items-center justify-center text-zinc-400 transition-opacity duration-200",
            hover ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <Video className="size-5" />
        </div>
      )}
      {showDuration && durationLabel ? <VideoDurationBadge label={durationLabel} /> : null}
      {children}
      <span className="sr-only">Video — hover for muted preview</span>
    </div>
  )
}
