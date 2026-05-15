import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Matches “Folders” / “Assets” hierarchy under the library toolbar (not the folder tile). */
export function BrowserSectionHeading({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-zinc-200/90 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500",
        className
      )}
    >
      {children}
    </div>
  )
}
