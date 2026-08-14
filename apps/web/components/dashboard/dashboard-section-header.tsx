import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { BrowserSectionHeading } from "@/components/libraries/browser-section-heading"

/**
 * The rule every dashboard section follows.
 *
 * The heading names the section and the underline separates it; the card below
 * is a container and carries no title of its own. Before this, System printed
 * its name twice — once as the section heading and again as the card title —
 * which read as two nested things rather than one.
 *
 * A section-level link lives here too, on the heading row, so "View all" and
 * "Background jobs" sit in the same place instead of one being above the card
 * and the other inside it.
 */
export function DashboardSectionHeader({
  children,
  href,
  action,
}: {
  children: React.ReactNode
  href?: string
  action?: string
}) {
  if (!href || !action) {
    return <BrowserSectionHeading>{children}</BrowserSectionHeading>
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200/90 pb-2">
      <BrowserSectionHeading className="w-auto border-0 pb-0">
        {children}
      </BrowserSectionHeading>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-[var(--arciin-accent-badge-bg)] hover:text-primary"
      >
        {action}
        <ChevronRight className="size-4" />
      </Link>
    </div>
  )
}
