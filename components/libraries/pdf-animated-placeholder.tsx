"use client"

import { cn } from "@/lib/utils"

/** Shared stacked-page + shimmer loader (initial open + per-page render). */
export function PdfAnimatedPlaceholder({
  width,
  className,
  label,
}: {
  /** Target page width in px; height follows ~US Letter aspect. */
  width: number
  className?: string
  label?: string
}) {
  const w = Math.max(180, Math.round(width))
  const h = Math.round(w * 1.294)
  const scale = w / 120
  const backW = Math.round(100 * scale)
  const backH = Math.round(132 * scale)
  const midW = Math.round(96 * scale)
  const midH = Math.round(120 * scale)
  const frontW = Math.round(84 * scale)
  const frontH = Math.round(104 * scale)
  const stackW = frontW + Math.round(18 * scale)
  const stackH = frontH + Math.round(22 * scale)

  return (
    <div
      className={cn("flex w-full shrink-0 justify-center py-1.5", className)}
      style={{ minHeight: h }}
      aria-hidden={!label}
      aria-label={label}
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: w, height: h }}
      >
        <div
          className="relative"
          style={{ width: stackW, height: stackH }}
        >
          <div
            className="arciin-pdf-load-page-3 absolute bottom-0 left-1/2 rounded-md bg-gradient-to-br from-zinc-700/80 to-zinc-800/40 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
            style={{
              width: backW,
              height: backH,
              transform: "translate(-50%, 6px)",
            }}
          />
          <div
            className="arciin-pdf-load-page-2 absolute bottom-0 left-1/2 rounded-md border border-white/10 bg-gradient-to-br from-zinc-600/90 to-zinc-700/50 shadow-lg"
            style={{
              width: midW,
              height: midH,
              transform: "translate(-50%, 3px)",
            }}
          />
          <div
            className="arciin-pdf-load-page-1 absolute bottom-0 left-1/2 overflow-hidden rounded-md border border-white/15 bg-white shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
            style={{
              width: frontW,
              height: frontH,
              transform: "translate(-50%, 0)",
            }}
          >
            <div className="flex h-full flex-col gap-[max(4px,0.35*scale)] p-[max(8px,0.55*scale)]">
              <div className="h-[max(5px,0.45*scale)] w-3/4 rounded-full bg-zinc-200/90" />
              <div className="h-[max(4px,0.35*scale)] w-full rounded-full bg-zinc-100" />
              <div className="h-[max(4px,0.35*scale)] w-[92%] rounded-full bg-zinc-100" />
              <div className="h-[max(4px,0.35*scale)] w-[88%] rounded-full bg-zinc-100" />
              <div className="mt-auto h-[max(4px,0.35*scale)] w-1/2 rounded-full bg-[#ff4f12]/35" />
            </div>
            <div className="arciin-pdf-load-shimmer pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
          </div>
        </div>
        {label ? (
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full pt-2 text-[11px] text-zinc-500">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  )
}
