"use client"

import { cn } from "@/lib/utils"

const EQ_BARS = [0.28, 0.44, 0.62, 0.48, 0.72, 0.56, 0.84, 0.64, 0.52, 0.76, 0.58, 0.4, 0.68, 0.5, 0.36] as const

export function AudioCardArtwork({
  isPlaying,
  isActive,
  className,
}: {
  isPlaying: boolean
  isActive: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative aspect-[4/3] overflow-hidden rounded-xl border bg-zinc-950 shadow-inner",
        isActive ? "border-primary/45 ring-2 ring-primary/20" : "border-border",
        isPlaying && "ring-2 ring-primary/25",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_50%_100%,rgba(255,79,18,0.14),transparent_65%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
        aria-hidden
      />

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[55%] items-end justify-center gap-[3px] px-5 pb-3 sm:gap-1 sm:px-6"
        aria-hidden
      >
        {EQ_BARS.map((height, index) => (
          <span
            key={index}
            className={cn(
              "w-[3px] min-h-[6px] rounded-full sm:w-1",
              isPlaying
                ? "bg-primary/80 arciin-audio-eq-bar"
                : isActive
                  ? "bg-primary/40"
                  : "bg-zinc-600/70",
            )}
            style={{
              height: `${Math.round(height * 100)}%`,
              animationDelay: isPlaying ? `${index * 85}ms` : undefined,
            }}
          />
        ))}
      </div>
    </div>
  )
}
