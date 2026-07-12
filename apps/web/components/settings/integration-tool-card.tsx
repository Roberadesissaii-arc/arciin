import Link from "next/link"
import { ChevronRight } from "lucide-react"

export function IntegrationToolCard({
  title,
  description,
  href,
  icon: Icon,
}: {
  title: string
  description: string
  href: string
  icon: React.ElementType
}) {
  return (
    <Link
      href={href}
      className="group flex h-full min-h-[8.5rem] flex-col rounded-2xl border border-border bg-card p-5 shadow-sm ring-1 ring-black/[0.03] transition-colors hover:border-primary/30 hover:bg-muted/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary/70" />
      </div>
      <div className="mt-4 min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        <p className="mt-1 min-h-[2.5rem] text-[12px] leading-snug text-muted-foreground">{description}</p>
      </div>
    </Link>
  )
}
