import { Archive } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Marks an archived file wherever it surfaces outside Archives — search
 * results, mainly — so it is never mistaken for an active one.
 */
export function ArchivedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-[18px] shrink-0 gap-1 rounded-md border-zinc-300 bg-zinc-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600",
        className,
      )}
      data-testid="asset-archived-badge"
    >
      <Archive aria-hidden />
      Archived
    </Badge>
  )
}
