import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

export function DashboardSectionDivider({ className }: { className?: string }) {
  return (
    <div className={cn("px-4 md:px-8 lg:px-12", className)} aria-hidden>
      <div className="h-px bg-zinc-200/80" />
    </div>
  )
}

export function DashboardSectionHeader({
  title,
  description,
  href,
  linkLabel = "View all",
  className,
}: {
  title: string
  description: string
  href?: string
  linkLabel?: string
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0 space-y-0.5 border-l-2 border-primary pl-3">
        <h3 className="font-heading text-base font-semibold tracking-tight text-zinc-900">
          {title}
        </h3>
        <p className="text-sm text-zinc-600">{description}</p>
      </div>
      {href ? (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-[var(--arciin-accent-badge-bg)] hover:text-primary"
        >
          {linkLabel}
          <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </div>
  )
}
