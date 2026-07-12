"use client"

import { cn } from "@/lib/utils"
import type { ImageHighlightRegion } from "@/lib/files/image-highlight-types"

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
  const widthPct = Math.round(zoom * 100)

  return (
    <div
      className={cn(
        "scrollbar-hide min-h-0 flex-1 overflow-auto overscroll-contain bg-zinc-50",
        className,
      )}
    >
      <div className="flex min-h-min w-full justify-center p-4 sm:p-6">
        <div
          className="relative shrink-0 transition-[width] duration-200 ease-out"
          style={{ width: `${widthPct}%`, maxWidth: "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={src}
            src={src}
            alt={alt}
            className="block h-auto w-full max-w-none object-contain shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
            draggable={false}
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
                    style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
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
