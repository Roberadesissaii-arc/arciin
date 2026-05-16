import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

export function DashboardSection({
  title,
  description,
  href,
  linkLabel = "View all",
  className,
  children,
}: {
  title: string
  description?: string
  href?: string
  linkLabel?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h3 className="font-heading text-base font-semibold tracking-tight text-zinc-900">
            {title}
          </h3>
          {description ? (
            <p className="max-w-xl text-sm text-zinc-600">{description}</p>
          ) : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary hover:text-primary/80"
          >
            {linkLabel}
            <ChevronRight className="size-4" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  )
}
