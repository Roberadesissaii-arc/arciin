"use client"

import { cn } from "@/lib/utils"
import type { ImageHighlightRegion } from "@/lib/files/image-highlight-types"

/**
 * Google Photos–style fit: image stays inside the preview pane (no page scroll
 * at default zoom). Zoom-in allows panning via overflow scroll.
 */
export function ImageAssetViewer({
  src,
  alt,
  zoom = 1,
  highlightRegions,
  className,
}: {
  src: string
  alt: string
  zoom?: number
  highlightRegions?: ImageHighlightRegion[]
  className?: string
}) {
  const zoomedIn = zoom > 1
  /** At ≤100% fit: use viewport box. Zoom multiplies the fit box when > 1. */
  const fitScale = Math.min(1, zoom)
  const fitPct = Math.round(fitScale * 100)

  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full flex-1 items-center justify-center bg-zinc-50",
        zoomedIn ? "overflow-auto overscroll-contain" : "overflow-hidden",
        "p-4 sm:p-6",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex items-center justify-center",
          zoomedIn
            ? "my-auto shrink-0"
            : "h-full max-h-full w-full max-w-full",
        )}
        style={
          zoomedIn
            ? {
                width: `${Math.round(zoom * 100)}%`,
                maxWidth: "none",
                minHeight: "min-content",
              }
            : {
                maxWidth: `${fitPct}%`,
                maxHeight: `${fitPct}%`,
              }
        }
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)]",
            "ring-1 ring-black/5",
            !zoomedIn && "max-h-full max-w-full",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={src}
            src={src}
            alt={alt}
            draggable={false}
            className={cn(
              "block rounded-xl object-contain",
              zoomedIn
                ? "h-auto w-full max-w-none"
                : "mx-auto h-auto max-h-[min(100%,calc(100dvh-9rem))] w-auto max-w-full",
            )}
          />
          {highlightRegions && highlightRegions.length > 0 ? (
            <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
              {highlightRegions.map((region, i) => {
                const left = region.x1 / 10
                const top = region.y1 / 10
                const width = (region.x2 - region.x1) / 10
                const height = (region.y2 - region.y1) / 10
                return (
                  <div
                    key={`${region.label ?? "box"}-${region.x1}-${region.y1}-${i}`}
                    className="absolute animate-in fade-in zoom-in-95 duration-300"
                    style={{
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${width}%`,
                      height: `${height}%`,
                    }}
                  >
                    <div className="absolute inset-0 rounded-md border-[3px] border-[#ff4f12] bg-[#ff4f12]/30 shadow-[0_0_0_2px_rgba(255,79,18,0.35),0_0_20px_rgba(255,79,18,0.25)]" />
                    {region.label ? (
                      <span className="absolute -top-6 left-0 max-w-[min(100%,12rem)] truncate rounded bg-[#ff4f12] px-1.5 py-0.5 text-[10px] font-medium leading-none text-white shadow-sm">
                        {region.label}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
