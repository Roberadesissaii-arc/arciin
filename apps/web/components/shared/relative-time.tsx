"use client"

import { formatRelativeDate, formatRelativeDateShort } from "@/lib/utils/format-date"

/**
 * Renders a relative timestamp ("3 minutes ago") without breaking hydration.
 *
 * formatRelativeDate is computed against "now", so the server renders at one
 * instant and the browser hydrates milliseconds later. Whenever that gap
 * crossed a boundary — 59 seconds becoming 1 minute — the markup no longer
 * matched and React threw #418 and re-rendered the whole tree on the client.
 * It fired intermittently on every page that shows a timestamp, which was
 * nearly all of them.
 *
 * suppressHydrationWarning is React's documented escape hatch for exactly this
 * case: the text is expected to differ by a tick and the client value wins.
 */
export function RelativeTime({
  value,
  short = false,
  className,
}: {
  value: string | Date
  short?: boolean
  className?: string
}) {
  const text = short ? formatRelativeDateShort(value) : formatRelativeDate(value)
  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  )
}
