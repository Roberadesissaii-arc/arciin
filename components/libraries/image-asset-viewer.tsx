"use client"

import { cn } from "@/lib/utils"

export function ImageAssetViewer({
  src,
  alt,
  zoom = 1,
  className,
}: {
  src: string
  alt: string
  zoom?: number
  className?: string
}) {
  const widthPct = Math.round(zoom * 100)

  return (
    <div
      className={cn(
        "scrollbar-hide min-h-0 flex-1 overflow-auto overscroll-contain bg-white",
        className,
      )}
    >
      <div className="flex min-h-min w-full justify-center p-4 sm:p-6">
        <div
          className="shrink-0 transition-[width] duration-200 ease-out"
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
        </div>
      </div>
    </div>
  )
}
