"use client"

import { Circle, Highlighter, Minus, Square, Strikethrough } from "lucide-react"

import { cn } from "@/lib/utils"
import type { PdfAnnotationStyle } from "@/lib/files/pdf-annotation-style"
import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"

/**
 * What was marked, as a row of chips under the answer.
 *
 * The assistant marking three things across two pages leaves the user hunting
 * for them: the viewer can only scroll to one, and the other two are somewhere
 * above or below with nothing saying where. Each chip names a mark and scrolls
 * to it, so the answer stays a list of places rather than a claim.
 */

const ICON: Record<PdfAnnotationStyle, typeof Circle> = {
  highlight: Highlighter,
  underline: Minus,
  circle: Circle,
  box: Square,
  strike: Strikethrough,
}

export function PdfMarkBadges({
  targets,
  currentPage,
  onFocus,
  className,
}: {
  targets: PdfHighlightTarget[]
  /** Page the viewer is on, so a chip can say when it leads somewhere else. */
  currentPage?: number
  onFocus: (target: PdfHighlightTarget, ordinal: number) => void
  className?: string
}) {
  if (targets.length === 0) return null

  return (
    <div className={cn("mt-2 flex flex-wrap gap-1.5", className)}>
      {targets.map((target, i) => {
        const Icon = ICON[target.style ?? "highlight"] ?? Highlighter
        const elsewhere = currentPage != null && target.page !== currentPage
        return (
          <button
            key={`${target.page}:${target.style}:${target.quote}:${i}`}
            type="button"
            onClick={() => onFocus(target, i)}
            title={`Go to “${target.quote}” on page ${target.page}`}
            className={cn(
              "group inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1",
              // Was orange-on-orange and unreadable against the light panel;
              // the chip keeps the accent, the label does not.
              "border-[#ff4f12]/45 bg-[#ff4f12]/8 text-[11px] text-zinc-700",
              "transition hover:border-[#ff4f12]/70 hover:bg-[#ff4f12]/20",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#ff4f12]",
            )}
          >
            <Icon className="size-3 shrink-0 text-[#ff4f12]" aria-hidden />
            <span className="truncate">{target.quote}</span>
            {/* Only worth the space when the chip leaves the page you are on. */}
            {elsewhere ? (
              <span className="shrink-0 text-zinc-500">p{target.page}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
