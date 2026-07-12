import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** Oversized decorative icon for dashboard intro cards (top-right). */
export function IntroCornerIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon
  className?: string
}) {
  return (
    <Icon
      className={cn(
        "pointer-events-none absolute -right-2 -top-2 size-28 text-primary/[0.07] sm:size-32",
        className,
      )}
      strokeWidth={1.25}
      aria-hidden
    />
  )
}
