"use client"

import { useMemo } from "react"

import type { PdfAnnotationStyle } from "@/lib/files/pdf-annotation-style"
import type { PdfHighlightRect } from "@/lib/files/pdf-highlight-types"

/**
 * One mark drawn over the page text.
 *
 * The marks are deliberately not uniform: a highlight sits behind the words, an
 * underline and a strike are single strokes, and a circle is drawn as an open
 * loop that overshoots its own start — the way a pen does. A perfect ellipse
 * reads as a UI chrome element rather than something drawn onto the page, which
 * is the whole point of offering it next to the highlighter.
 */

const ACCENT = "#ff4f12"

/**
 * A stable per-mark wobble.
 *
 * Hand-drawn strokes need to vary or a column of them looks stamped, but the
 * variation must not change between renders — a circle that reshapes itself on
 * every scroll or zoom is worse than a rigid one. Derived from the rect's own
 * geometry, so it is stable for as long as the mark is.
 */
function wobbleSeed(rect: PdfHighlightRect): number {
  const n = Math.abs(Math.round(rect.left * 7 + rect.top * 13 + rect.width * 3))
  return (n % 100) / 100
}

function CircleMark({ rect }: { rect: PdfHighlightRect }) {
  const seed = wobbleSeed(rect)
  // Room for the stroke to bulge past the text without clipping.
  const padX = Math.max(8, rect.height * 0.55)
  const padY = Math.max(5, rect.height * 0.4)
  const w = rect.width + padX * 2
  const h = rect.height + padY * 2
  const stroke = Math.max(1.6, Math.min(2.6, rect.height * 0.11))

  const path = useMemo(() => {
    const cx = w / 2
    const cy = h / 2
    const rx = w / 2 - stroke
    const ry = h / 2 - stroke
    // Tilt and radius jitter, small enough to read as a hand rather than a bug.
    const tilt = (seed - 0.5) * 0.14
    const j = (t: number) => 1 + (seed - 0.5) * 0.08 * Math.sin(t * 3)

    const pts: string[] = []
    // Just past a full turn: the overshoot is what makes it look drawn.
    const turns = 1.08
    const steps = 44
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2 * turns - Math.PI / 2
      const r1 = rx * j(t)
      const r2 = ry * j(t + 1.7)
      const x = cx + r1 * Math.cos(t) * Math.cos(tilt) - r2 * Math.sin(t) * Math.sin(tilt)
      const y = cy + r1 * Math.cos(t) * Math.sin(tilt) + r2 * Math.sin(t) * Math.cos(tilt)
      pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    }
    return pts.join(" ")
  }, [h, seed, stroke, w])

  return (
    <svg
      className="absolute animate-in fade-in duration-500"
      style={{ left: rect.left - padX, top: rect.top - padY, width: w, height: h }}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      aria-hidden
    >
      <path
        d={path}
        stroke={ACCENT}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    </svg>
  )
}

function StrokeMark({
  rect,
  at,
}: {
  rect: PdfHighlightRect
  /** Fraction of the rect height the stroke sits at: 1 = baseline, 0.5 = middle. */
  at: number
}) {
  const seed = wobbleSeed(rect)
  const stroke = Math.max(1.4, Math.min(2.4, rect.height * 0.09))
  const y = rect.height * at
  // A drawn line is not level; drift by a fraction of its own weight.
  const drift = (seed - 0.5) * stroke * 1.2

  return (
    <svg
      className="absolute animate-in fade-in duration-500"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height + stroke * 2 }}
      viewBox={`0 0 ${rect.width} ${rect.height + stroke * 2}`}
      fill="none"
      aria-hidden
    >
      <path
        d={`M${stroke},${y - drift} Q${rect.width / 2},${y + drift * 2} ${rect.width - stroke},${y + drift}`}
        stroke={ACCENT}
        strokeWidth={stroke}
        strokeLinecap="round"
        opacity={0.9}
      />
    </svg>
  )
}

export function PdfAnnotationMark({
  rect,
  style,
}: {
  rect: PdfHighlightRect
  style: PdfAnnotationStyle
}) {
  if (style === "circle") return <CircleMark rect={rect} />
  // Just below the baseline, so descenders are not cut through.
  if (style === "underline") return <StrokeMark rect={rect} at={0.94} />
  if (style === "strike") return <StrokeMark rect={rect} at={0.55} />

  if (style === "box") {
    return (
      <div
        className="absolute rounded-[3px] border-[1.5px] border-[#ff4f12]/80 animate-in fade-in duration-300"
        style={{
          left: rect.left - 3,
          top: rect.top - 2,
          width: rect.width + 6,
          height: rect.height + 4,
        }}
        aria-hidden
      />
    )
  }

  return (
    <div
      className="absolute rounded-sm border border-[#ff4f12]/70 bg-[#ff4f12]/30 shadow-[0_0_0_1px_rgba(255,79,18,0.15)] animate-in fade-in duration-300"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      aria-hidden
    />
  )
}
